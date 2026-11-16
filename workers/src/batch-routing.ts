import type {Env,Route} from './types';
import {Failure,httpJson,httpsBase} from './utils';
import {finish,roadResponse,routePoints} from './routing';

type Job={id:string;stops:number};
export async function batchRoutes(jobs:Job[],origin:{latitude:number;longitude:number;returnLatitude?:number|null;returnLongitude?:number|null},env:Env):Promise<Map<string,Route|Failure>> {
  const result=new Map<string,Route|Failure>(),prepared=new Map<string,ReturnType<typeof routePoints>>();
  for(const job of jobs){try{prepared.set(job.id,routePoints(job.id,origin.latitude,origin.longitude,origin.returnLatitude??origin.latitude,origin.returnLongitude??origin.longitude));}catch(e){result.set(job.id,e instanceof Failure?e:new Failure('INVALID_PROVIDER_RESPONSE'));}}
  if(!prepared.size)return result;
  let response;
  try{response=await httpJson(httpsBase(env.OSRM_BATCH_URL!)+'/v1/routes/batch',{method:'POST',headers:{'Content-Type':'application/json',...(env.OSRM_BATCH_TOKEN?{Authorization:'Bearer '+env.OSRM_BATCH_TOKEN}:{})},body:JSON.stringify({version:1,routes:[...prepared].map(([id,{points}])=>({id,coordinates:points.map(p=>[p.longitude,p.latitude])}))})},85000);}
  catch{for(const id of prepared.keys())result.set(id,new Failure('PROVIDER_UNAVAILABLE'));return result;}
  const fail=(code:string)=>{for(const id of prepared.keys())result.set(id,new Failure(code));return result;};
  if(response.status!==200)return fail(response.status===429?'RATE_LIMIT':response.status===403?'PROVIDER_PERMISSION_DENIED':'PROVIDER_UNAVAILABLE');
  const data=response.data as {version?:unknown;results?:unknown};
  if(!data||data.version!==1||!Array.isArray(data.results))return fail('INVALID_PROVIDER_RESPONSE');
  // Require exactly one ordered response per requested candidate, including those
  // not executed after a global provider failure. Never reuse a different route.
  const expected=[...prepared.keys()];
  if(data.results.length!==expected.length)return fail('INVALID_PROVIDER_RESPONSE');
  for(let i=0;i<expected.length;i++){
    const id=expected[i],value=data.results[i];
    if(!value||typeof value!=='object'||value.id!==id)return fail('INVALID_PROVIDER_RESPONSE');
    try{
      if(value.error){if(value.error!=='PROVIDER_UNAVAILABLE')throw new Failure('INVALID_PROVIDER_RESPONSE');throw new Failure(value.error);}
      if(!Number.isInteger(value.status))throw new Failure('INVALID_PROVIDER_RESPONSE');
      const {points,warnings}=prepared.get(id)!,job=jobs.find(x=>x.id===id)!;
      result.set(id,finish(points,roadResponse(points,{status:value.status,data:value.data},false),job.stops*60,'HIGHLIGHT_ONLY',warnings));
    }catch(e){result.set(id,e instanceof Failure?e:new Failure('INVALID_PROVIDER_RESPONSE'));}
  }
  return result;
}
