import {z} from 'zod';
import type {Env} from './types';
import {acquireRoadRecovery,finishRoadRecovery,publicNearestPath,recordRoadCooldown} from './road-provider';
import {Failure,httpJson} from './utils';

export const keepaliveCron='*/10 * * * *';
const origin='https://flowad-roads.ravirgo.com';
const hour=3600000,interval=600000;
const reviewed=z.object({
 checkedAt:z.iso.datetime({offset:true}),policyApproved:z.boolean(),resourcesOk:z.boolean(),
 freeHoursForExperiment:z.number().min(0).max(750),baselineSuccessRate:z.number().min(0).max(1)
});
const startDate=z.iso.datetime({offset:true});
const nearest=z.object({code:z.literal('Ok'),waypoints:z.tuple([z.object({
 location:z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)]),distance:z.number().nonnegative()
})])});

function skip(reason:string){
 console.log(JSON.stringify({event:'osrm_keepalive_skip',reason}));
}

function plannedWindow(env:Env){
 if(env.ROAD_KEEPALIVE_INTERVAL_MINUTES!=='10')return 'invalid_interval';
 if(env.ROAD_ROUTING_URL!==origin)return 'invalid_road_origin';
 const start=startDate.safeParse(env.ROAD_KEEPALIVE_START_AT),days=Number(env.ROAD_KEEPALIVE_EXPERIMENT_DAYS??'3');
 if(!start.success)return env.ROAD_KEEPALIVE_START_AT?'invalid_start_at':'missing_start_at';
 if(!Number.isInteger(days)||days<3||days>7)return 'invalid_duration';
 const starts=Date.parse(start.data);
 return {starts,ends:starts+days*24*hour};
}

function operatorReview(env:Env){
 try{return reviewed.safeParse(JSON.parse(env.ROAD_KEEPALIVE_REVIEW??''));}
 catch{return null;}
}

async function stop(env:Env,starts:number,reason:string){
 const updated=await env.DB.prepare('UPDATE road_keepalive_experiments SET stop_reason=? WHERE starts_at=? AND stop_reason IS NULL RETURNING attempts')
  .bind(reason,starts).first<{attempts:number}>();
 if(updated)console.log(JSON.stringify({event:'osrm_keepalive_stop',startsAt:starts,reason,attempts:updated.attempts}));
 else skip(reason);
}

export async function runRoadKeepalive(env:Env,scheduledTime:number){
 if(env.ROAD_KEEPALIVE_ENABLED!=='true')return;
 const window=plannedWindow(env);
 if(typeof window==='string'){skip(window);return;}
 const at=Date.now(),{starts,ends}=window,slot=Math.floor(scheduledTime/interval);
 if(at<starts){skip('before_start');return;}
 if(at>=ends){await stop(env,starts,'experiment_ended');return;}
 if(scheduledTime<starts||scheduledTime>at||at-scheduledTime>60000)return;
 const review=operatorReview(env);
 if(!review?.success){await stop(env,starts,env.ROAD_KEEPALIVE_REVIEW?'invalid_operator_review':'missing_operator_review');return;}
 const {checkedAt,policyApproved,resourcesOk,freeHoursForExperiment,baselineSuccessRate}=review.data;
 const reviewedAt=Date.parse(checkedAt);
 if(!policyApproved||!resourcesOk||reviewedAt>at||at-reviewedAt>=24*hour){
  await stop(env,starts,'operator_review_blocked');return;
 }
 // The reviewed budget is net of other services. Reserve all time that could
 // have passed since that review, even if this service has been asleep.
 if(freeHoursForExperiment*hour<ends-Math.max(starts,reviewedAt)+15*60000){await stop(env,starts,'insufficient_free_hours');return;}
 await env.DB.prepare('INSERT OR IGNORE INTO road_keepalive_experiments(starts_at,ends_at) VALUES(?,?)').bind(starts,ends).run();
 const state=await env.DB.prepare('SELECT ends_at,user_attempts,user_successes FROM road_keepalive_experiments WHERE starts_at=?')
  .bind(starts).first<{ends_at:number;user_attempts:number;user_successes:number}>();
 if(!state)return;
 if(at>=state.ends_at){await stop(env,starts,'experiment_ended');return;}
 if(state.user_attempts>=20&&state.user_successes/state.user_attempts<baselineSuccessRate-.1){
  await stop(env,starts,'user_success_rate_declined');return;
 }
 // Reserve the slot before competing for the shared post-429 recovery lease.
 const claim=await env.DB.prepare(`UPDATE road_keepalive_experiments
   SET last_slot=?
   WHERE starts_at=? AND ends_at>? AND stop_reason IS NULL AND last_slot<?
     AND last_user_route_at<=?
     AND NOT EXISTS (SELECT 1 FROM road_keepalive_experiments WHERE last_slot>=?)
     AND NOT EXISTS (SELECT 1 FROM road_provider_cooldown WHERE origin=? AND (retry_until>? OR probe_until>?))
   RETURNING starts_at`).bind(slot,starts,at,slot,at-30000,slot,origin,at,at).first();
 if(!claim)return;
 let lease:number;
 try{lease=await acquireRoadRecovery(env,origin,8000);}
 catch(e){
  if(e instanceof Failure){skip(e.code);return;}
  throw e;
 }
 const attempt=await env.DB.prepare('UPDATE road_keepalive_experiments SET attempts=attempts+1 WHERE starts_at=? AND last_slot=? AND stop_reason IS NULL RETURNING attempts')
  .bind(starts,slot).first<{attempts:number}>();
 if(!attempt)return;

 const before=performance.now();
 let status:number|null=null,retryAfterSeconds:number|undefined,outcome='connection_failure';
 let diagnostics:Awaited<ReturnType<typeof httpJson>>['diagnostics'];
 try{
  const response=await httpJson(origin+publicNearestPath,{cache:'no-store',headers:{'Cache-Control':'no-cache'}},8000,{stopAtRateLimit:true,captureDiagnostics:true});
  status=response.status;
  retryAfterSeconds=response.retryAfterSeconds;
  diagnostics=response.diagnostics;
  if(response.challenged||status===403||status===401)outcome='provider_access_blocked';
  else if(status===429)outcome='rate_limited';
  else if(status>=500)outcome='upstream_5xx';
  else if(status===200&&nearest.safeParse(response.data).success
   &&!['HIT','STALE','UPDATING','REVALIDATED'].includes(diagnostics?.cacheStatus??''))outcome='ok';
  else outcome='origin_unconfirmed';
 }catch(e){if(e instanceof Failure&&e.code==='UPSTREAM_TIMEOUT')outcome='timeout';}
 console.log(JSON.stringify({event:'osrm_keepalive_probe',startsAt:starts,attemptedAt:at,attempt:attempt.attempts,
  status,elapsedMs:Math.round(performance.now()-before),outcome,retryAfterSeconds,...diagnostics}));
 if(outcome==='rate_limited')await recordRoadCooldown(env,origin,retryAfterSeconds??30);
 if(outcome==='ok')await finishRoadRecovery(env,origin,lease);
 const success=outcome==='ok'?1:0,limited=outcome==='rate_limited'?1:0;
 const updated=await env.DB.prepare(`UPDATE road_keepalive_experiments
   SET successes=successes+?,rate_limits=rate_limits+?,
       failure_streak=CASE WHEN ?=1 THEN 0 ELSE failure_streak+1 END
   WHERE starts_at=? AND last_slot=? RETURNING rate_limits,failure_streak`)
  .bind(success,limited,success,starts,slot).first<{rate_limits:number;failure_streak:number}>();
 if(outcome==='provider_access_blocked')await stop(env,starts,outcome);
 else if((updated?.rate_limits??0)>=2)await stop(env,starts,'repeated_429');
 else if((updated?.failure_streak??0)>=3)await stop(env,starts,'consecutive_probe_failures');
}

export async function recordExperimentTraffic(env:Env,at:number,outcome?:'success'|'failure'){
 if(env.ROAD_KEEPALIVE_ENABLED!=='true')return;
 const window=plannedWindow(env);
 if(typeof window==='string'||at<window.starts||at>=window.ends)return;
 try{
  if(outcome===undefined){
   await env.DB.prepare(`INSERT INTO road_keepalive_experiments(starts_at,ends_at,last_user_route_at) VALUES(?,?,?)
    ON CONFLICT(starts_at) DO UPDATE SET last_user_route_at=MAX(last_user_route_at,excluded.last_user_route_at)
    WHERE ends_at>excluded.last_user_route_at AND stop_reason IS NULL`).bind(window.starts,window.ends,at).run();
  }else{
   await env.DB.prepare('UPDATE road_keepalive_experiments SET user_attempts=user_attempts+1,user_successes=user_successes+? WHERE starts_at=? AND ends_at>? AND stop_reason IS NULL')
    .bind(outcome==='success'?1:0,window.starts,at).run();
  }
 }catch{console.warn(JSON.stringify({event:'osrm_keepalive_metrics_unavailable'}));}
}
