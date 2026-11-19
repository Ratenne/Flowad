import type {Env} from './types';
import {Failure,httpJson,httpsBase} from './utils';
const pending=new Map<string,Promise<{ready:boolean;retryAfterSeconds?:number}>>();
const recent=new Map<string,{until:number;limited:boolean;warming?:boolean}>();
export function resetProviderReadiness(){recent.clear();}
export function providerReady(key:string){
 const current=recent.get(key);
 if(!current?.limited||current.until<=Date.now())recent.set(key,{until:Date.now()+60000,limited:false});
}
export function providerLimited(key:string,seconds:number){
 recent.set(key,{until:Math.max(recent.get(key)?.limited?recent.get(key)!.until:0,Date.now()+seconds*1000),limited:true});
}
export function checkProviderLimit(key:string){
 const state=recent.get(key);
 if(state?.limited&&state.until>Date.now())throw new Failure('ROAD_PROVIDER_RATE_LIMIT',503,Math.ceil((state.until-Date.now())/1000));
}
// A public reference point checks the OSRM service, never the user's location.
// No scheduled warming and no retry held inside a Worker invocation.
export async function navigationReadiness(env:Env){
 if(!env.ROAD_ROUTING_URL)throw new Failure('ROAD_PROVIDER_NOT_CONFIGURED',503);
 const key=env.ROAD_ROUTING_URL;
 checkProviderLimit(key);
 const previous=recent.get(key);
 if(previous&&previous.until>Date.now())return previous.warming?{ready:false,retryAfterSeconds:Math.ceil((previous.until-Date.now())/1000)}:{ready:true};
 if(pending.has(key))return pending.get(key)!;
 const operation=(async()=>{
  const u=new URL(key),base=u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)?u.origin:httpsBase(key);
  const warming=()=>{const current=recent.get(key);if(!current||current.until<=Date.now())recent.set(key,{until:Date.now()+20000,limited:false,warming:true});return {ready:false,retryAfterSeconds:20};};
  let response;
  try{response=await httpJson(base+'/nearest/v1/driving/126.978,37.5665?number=1',{},8000);}
  catch{return warming();}
  if(response.status!==200&&env.SAFE_UPSTREAM_DIAGNOSTICS==='true')console.warn(JSON.stringify({event:'osrm_readiness',status:response.status,retryAfterSeconds:response.retryAfterSeconds,challenged:response.challenged===true,viaRender:response.viaRender,viaCloudflare:response.viaCloudflare}));
  if(response.challenged)throw new Failure('ROAD_PROVIDER_CHALLENGE',503);
  if(response.status===429)providerLimited(key,response.retryAfterSeconds??30);
  if(response.status===429)throw new Failure('ROAD_PROVIDER_RATE_LIMIT',503,response.retryAfterSeconds??30);
  if(response.status===403)throw new Failure('PROVIDER_PERMISSION_DENIED',503);
  if([502,503,504].includes(response.status))return warming();
  const data=response.data as {code?:string;waypoints?:unknown[]}|null;
  if(response.status!==200||data?.code!=='Ok'||!Array.isArray(data.waypoints)||data.waypoints.length!==1)throw new Failure('INVALID_PROVIDER_RESPONSE',503);
  providerReady(key);return {ready:true};
 })();
 pending.set(key,operation);
 try{return await operation;}finally{pending.delete(key);}
}
