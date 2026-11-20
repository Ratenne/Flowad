import {it,expect,vi} from 'vitest';
import {call,config,external,json} from './helpers';
import {osrmRequest} from '../src/road-provider';
it.each([502,503,504])('reports startup HTTP %s as pending readiness, never verified',async status=>{
 const provider=external(()=>json(null,status));
 const r=await call('/api/navigation/readiness',{}, {env:config({ROAD_ROUTING_URL:'https://roads.test'})});
 expect(r.status).toBe(202);expect(await r.json()).toEqual({ready:false,retryAfterSeconds:20});expect((await call('/api/navigation/readiness',{}, {env:config({ROAD_ROUTING_URL:'https://roads.test'})})).status).toBe(202);expect(provider).toHaveBeenCalledOnce();
});
it('requires a valid OSRM response before declaring readiness',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 external(()=>json({code:'Ok',waypoints:[{location:[126.978,37.5665]}]}));
 expect(await (await call('/api/navigation/readiness',{}, {env:e})).json()).toEqual({ready:true});
 const unused=external(()=>new Response('loading page'));expect((await call('/api/navigation/readiness',{}, {env:e})).status).toBe(200);expect(unused).not.toHaveBeenCalled();
 expect((await call('/api/navigation/readiness',{}, {env:{...e,ROAD_ROUTING_URL:'https://invalid.test'}})).status).toBe(503);
});
it('does not hide rate limits or Cloudflare challenges as readiness',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://limited.test'});
 external(()=>new Response('',{status:429,headers:{'Retry-After':'90'}}));
 const r=await call('/api/navigation/readiness',{}, {env:e});expect(r.status).toBe(503);expect(r.headers.get('Retry-After')).toBe('90');
 const unused=external(()=>new Response('',{status:403,headers:{'cf-mitigated':'challenge'}}));
 expect(await (await call('/api/navigation/readiness',{}, {env:e})).json()).toEqual({error:'ROAD_PROVIDER_RATE_LIMIT'});expect(unused).not.toHaveBeenCalled();
 expect(await (await call('/api/navigation/readiness',{}, {env:{...e,ROAD_ROUTING_URL:'https://challenge.test'}})).json()).toEqual({error:'ROAD_PROVIDER_CHALLENGE'});
});
it('expires a positive probe, honors the shared limit and recovers after Retry-After',async()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(100000);
 try{
  const env=config({ROAD_ROUTING_URL:'https://expiry.test',SAFE_UPSTREAM_DIAGNOSTICS:'true'});
  const probe=()=>call('/api/navigation/readiness',{}, {env});
  const ok=()=>json({code:'Ok',waypoints:[{}]});
  const provider=external(ok);
  expect((await probe()).status).toBe(200);
  time.mockReturnValue(159999);
  expect((await probe()).status).toBe(200);
  expect(provider).toHaveBeenCalledOnce();
  time.mockReturnValue(160000);
  external(()=>new Response('Busy',{status:429,headers:{'Retry-After':'30','x-render-routing':'hibernate-rate-limited'}}));
  expect((await probe()).status).toBe(503);
  const recovered=external(ok);
  time.mockReturnValue(189001);
  const limited=await probe();
  expect(limited.status).toBe(503);
  expect(limited.headers.get('Retry-After')).toBe('1');
  expect(recovered).not.toHaveBeenCalled();
  time.mockReturnValue(190000);
  expect(await (await probe()).json()).toEqual({ready:true});
  expect(recovered).toHaveBeenCalledOnce();
 }finally{time.mockRestore();}
});
it('shares the cooldown across OSRM paths and permits only one recovery request',async()=>{
 const origin='https://shared-roads.test',env=config({ROAD_ROUTING_URL:origin});
 const route=origin+'/route/v1/driving/public-fixture',table=origin+'/table/v1/driving/public-fixture';
 const clock=vi.spyOn(Date,'now').mockReturnValue(100000);
 const throttled=external(()=>new Response('Busy',{status:429,headers:{'Retry-After':'30'}}));
 expect((await osrmRequest(env,route,{},8000)).status).toBe(429);
 expect((await call('/api/navigation/readiness',{}, {env})).status).toBe(503);
 await expect(osrmRequest(env,table,{},8000)).rejects.toMatchObject({code:'ROAD_PROVIDER_RATE_LIMIT'});
 expect(throttled).toHaveBeenCalledOnce();
 clock.mockReturnValue(130000);
 let finish!:(response:Response)=>void;
 let signalStarted!:()=>void;
 const started=new Promise<void>(resolve=>{signalStarted=resolve;});
 const pendingProvider=external(()=>new Promise<Response>(resolve=>{finish=resolve;signalStarted();}));
 const recovery=osrmRequest(env,table,{},8000);
 await started;
 await expect(osrmRequest(env,route,{},8000)).rejects.toMatchObject({code:'ROAD_VERIFICATION_BUSY'});
 finish(json({code:'Ok'}));
 expect((await recovery).status).toBe(200);
 expect(pendingProvider).toHaveBeenCalledOnce();
 const healthy=external(()=>json({code:'Ok'}));
 expect((await osrmRequest(env,route,{},8000)).status).toBe(200);
 expect(healthy).toHaveBeenCalledOnce();
});
