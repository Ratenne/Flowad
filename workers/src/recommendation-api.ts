import type {Hono} from 'hono';
import {z} from 'zod';
import type {Bindings} from './types';
import {recommendation,recommend} from './recommendations';
import {resolve} from './tickets';
import {roadVerificationRequest,verifySelected} from './selected-route';
import {Failure,hash,nonce,now} from './utils';
import {dynamicPolicy} from './dynamic-recommendations';
import {navigationReadiness} from './navigation-readiness';
import {recordExperimentTraffic} from './road-keepalive';
const inFlight=new Map<string,Promise<unknown>>();
export const recommendationMethods={'/api/recommendations':'POST','/api/navigation/resolve':'POST','/api/navigation/verify':'POST','/api/navigation/readiness':'POST'} as const;
export function mountRecommendationApi(app:Hono<Bindings>){
 app.post('/api/navigation/readiness',async c=>{
  const result=await navigationReadiness(c.env);
  if(result.retryAfterSeconds)c.header('Retry-After',String(result.retryAfterSeconds));
  return c.json(result,result.ready?200:202);
 });
 app.post('/api/recommendations',async c=>{
  const raw:unknown=await c.req.json().catch(()=>null),r=recommendation.safeParse(raw);
  if(!r.success)return c.json({error:'Invalid recommendation request'},400);
  const key=await hash(JSON.stringify({...r.data,requestId:undefined}));
  if(inFlight.has(key))return c.json(await inFlight.get(key));
  if(inFlight.size>=2)return c.json({error:'RECOMMENDATION_BUSY'},503);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),dynamicPolicy.totalMs);
  const cancel=()=>controller.abort();c.req.raw.signal.addEventListener('abort',cancel,{once:true});if(c.req.raw.signal.aborted)cancel();
  const pending=(async()=>{
   const lease=nonce();
   const slot=await c.env.DB.prepare('UPDATE poi_routing_slots SET lease=?,expires=? WHERE id=(SELECT id FROM poi_routing_slots WHERE expires<? ORDER BY id LIMIT 1) RETURNING id').bind(lease,now()+Math.ceil(dynamicPolicy.totalMs/1000)+15,now()).first<{id:number}>();
   if(!slot)throw new Failure('RECOMMENDATION_BUSY',503,3);
   try{return await recommend(r.data,c.env,controller.signal);}
   finally{await c.env.DB.prepare('UPDATE poi_routing_slots SET lease=NULL,expires=0 WHERE id=? AND lease=?').bind(slot.id,lease).run();}
  })();inFlight.set(key,pending);
  // Finish bounded work and release its lease even if the browser disconnects.
  if(typeof c.executionCtx?.waitUntil==='function')c.executionCtx.waitUntil(pending.then(()=>undefined,()=>undefined));
  try{return c.json(await pending);}finally{clearTimeout(timer);c.req.raw.signal.removeEventListener('abort',cancel);inFlight.delete(key);}
 });
 app.post('/api/navigation/resolve',async c=>{
  try{const r=z.object({ticket:z.string()}).parse(await c.req.json());return c.json(await resolve(r.ticket,c.env.NAVIGATION_TICKET_SECRET));}catch{return c.body(null,400);}
 });
 app.post('/api/navigation/verify',async c=>{
  const input:unknown=await c.req.json().catch(()=>null),parsed=roadVerificationRequest.safeParse(input);
  if(!parsed.success)return c.json({verificationStatus:'ROAD_ROUTE_UNAVAILABLE',roadVerified:false,error:'INVALID_REQUEST'},400);
  const at=Date.now(),started=performance.now();
  const manualRetry=!!(input&&typeof input==='object'&&'manualRetry'in input&&input.manualRetry===true);
  const report=async(status:number,error?:Failure)=>{
   const elapsedMs=Math.round(performance.now()-started);
   if(c.env.SAFE_UPSTREAM_DIAGNOSTICS==='true'){
    console.log(JSON.stringify({event:'road_verification',status,elapsedMs,manualRetry,error:error?.code,
     timedOut:error?.code==='ROAD_PROVIDER_TIMEOUT',over25s:elapsedMs>25000,retryAfterSeconds:error?.retryAfterSeconds}));
   }
   if(status===200||status>=500||['NO_ROAD_ROUTE','WAYPOINT_TOO_FAR_FROM_ROAD'].includes(error?.code??'')){
    await recordExperimentTraffic(c.env,at,status===200?'success':'failure');
   }
  };
  await recordExperimentTraffic(c.env,at);
  try{
   const verified=await verifySelected(parsed.data,c.env);
   await report(200);
   return c.json(verified);
  }catch(e){
   const error=e instanceof Failure?e:new Failure('SERVICE_UNAVAILABLE',503);
   await report(error.status,error);
   if(error.retryAfterSeconds)c.header('Retry-After',String(error.retryAfterSeconds));
   return c.json({verificationStatus:'ROAD_ROUTE_UNAVAILABLE',roadVerified:false,error:error.code,...error.context},error.status);
  }
 });
}
