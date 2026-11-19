import type {Env} from './types';
import {Failure,httpJson,httpsBase} from './utils';
const pending=new Map<string,Promise<{ready:boolean;retryAfterSeconds?:number}>>();
// A public reference point checks the OSRM service, never the user's location.
// No scheduled warming and no retry held inside a Worker invocation.
export async function navigationReadiness(env:Env){
 if(!env.ROAD_ROUTING_URL)throw new Failure('ROAD_PROVIDER_NOT_CONFIGURED',503);
 const key=env.ROAD_ROUTING_URL;
 if(pending.has(key))return pending.get(key)!;
 const operation=(async()=>{
  const u=new URL(key),base=u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)?u.origin:httpsBase(key);
  let response;
  try{response=await httpJson(base+'/nearest/v1/driving/126.978,37.5665?number=1',{},8000);}
  catch{return {ready:false,retryAfterSeconds:20};}
  if(response.challenged)throw new Failure('ROAD_PROVIDER_CHALLENGE',503);
  if(response.status===429)throw new Failure('ROAD_PROVIDER_RATE_LIMIT',503,response.retryAfterSeconds??30);
  if(response.status===403)throw new Failure('PROVIDER_PERMISSION_DENIED',503);
  if([502,503,504].includes(response.status))return {ready:false,retryAfterSeconds:20};
  const data=response.data as {code?:string;waypoints?:unknown[]}|null;
  if(response.status!==200||data?.code!=='Ok'||!Array.isArray(data.waypoints)||data.waypoints.length!==1)throw new Failure('INVALID_PROVIDER_RESPONSE',503);
  return {ready:true};
 })();
 pending.set(key,operation);
 try{return await operation;}finally{pending.delete(key);}
}
