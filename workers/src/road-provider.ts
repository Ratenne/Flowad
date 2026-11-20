import type {Env} from './types';
import {Failure,httpJson} from './utils';

type Cooldown = {retry_until:number;probe_until:number};
const findSql='SELECT retry_until,probe_until FROM road_provider_cooldown WHERE origin=?';

async function cooldown(env:Env,origin:string){
 return env.DB.prepare(findSql).bind(origin).first<Cooldown>();
}

function check(state:Cooldown|null,at:number){
 if(state&&state.retry_until>at)throw new Failure('ROAD_PROVIDER_RATE_LIMIT',503,Math.ceil((state.retry_until-at)/1000));
 if(state&&state.probe_until>at)throw new Failure('ROAD_VERIFICATION_BUSY',503,3);
}

export async function checkRoadCooldown(env:Env,origin:string){
 const state=await cooldown(env,origin);
 check(state,Date.now());
 return state!==null;
}

export async function osrmRequest(env:Env,url:string,init:RequestInit|undefined,timeout=10000){
 const origin=new URL(url).origin;
 const state=await cooldown(env,origin),at=Date.now();
 check(state,at);
 let probeUntil=0;
 if(state){
  // After a 429, let only one Worker invocation contact this provider first.
  probeUntil=at+timeout+5000;
  const lease=await env.DB.prepare('UPDATE road_provider_cooldown SET probe_until=? WHERE origin=? AND retry_until<=? AND probe_until<=? RETURNING origin')
   .bind(probeUntil,origin,at,at).first();
  if(!lease){
   check(await cooldown(env,origin),Date.now());
   throw new Failure('ROAD_VERIFICATION_BUSY',503,3);
  }
 }
 const response=await httpJson(url,init,timeout,{stopAtRateLimit:true});
 if(response.status===429&&!response.challenged){
  const seconds=response.retryAfterSeconds??30;
  const until=Math.min(Number.MAX_SAFE_INTEGER,Date.now()+seconds*1000);
  await env.DB.prepare(`INSERT INTO road_provider_cooldown(origin,retry_until,probe_until) VALUES(?,?,0)
    ON CONFLICT(origin) DO UPDATE SET retry_until=MAX(retry_until,excluded.retry_until),probe_until=0`).bind(origin,until).run();
 }else if(probeUntil&&!response.challenged&&answeredByOsrm(response)){
  await env.DB.prepare('DELETE FROM road_provider_cooldown WHERE origin=? AND probe_until=?').bind(origin,probeUntil).run();
 }
 return response;
}

function answeredByOsrm(response:Awaited<ReturnType<typeof httpJson>>){
 const code=(response.data as {code?:string}|null)?.code;
 return response.status===200?code==='Ok':response.status===400&&['NoRoute','NoSegment','NoTable','TooBig','InvalidUrl'].includes(code??'');
}
