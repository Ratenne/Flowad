import {recommendWithRouting,recommendation as parseRecommendation} from '../src/legacy-recommendations';
import {it,expect,vi} from 'vitest';
import {call,base,config,external,json,authenticated} from './helpers';
import {resolve,issueCourseCredentials} from '../src/tickets';
import {Sessions} from '../src/repository';
import {now} from '../src/utils';
import {issue} from '../src/tickets';
import {point,finish} from '../src/routing';
it('preserves the full dynamic itinerary in Tesla preparation without any vehicle command',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test',TESLA_CLIENT_ID:'public',TESLA_CLIENT_SECRET:'public',TESLA_REDIRECT_URI:'https://flowad.test/api/tesla/callback'});
 const points=[point(0,'ORIGIN','출발',35.1796,129.0756),point(1,'SCENIC_WAYPOINT','해안',35.2,129.2),point(2,'DESTINATION','목적지',35.3,129.25),point(3,'RETURN','복귀',35.1796,129.0756)];
 const ticket=await issue('dyn-Ab_Cd',finish(points,{legs:[],status:'ESTIMATED_NOT_ROAD_ROUTED',provider:'TEST',geometryStatus:'NOT_AVAILABLE'},0,'UNAVAILABLE',[]),e.NAVIGATION_TICKET_SECRET);
 const provider=external(url=>{expect(new URL(url).hostname).toBe('roads.test');const coords=new URL(url).pathname.split('/').at(-1)!.split(';').map(v=>v.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map(()=>({distance:10000,duration:900}))}]});});
 const a=await authenticated({},e),response=await a.post('navigation/preview',{ticket,vehicleType:'ice'});
 expect(response.status).toBe(200);const plan=await response.json() as {stops:unknown[];navigationTicket:string};
 expect(plan).toMatchObject({mode:'SINGLE_DESTINATION',multiStopStatus:'UNSUPPORTED',commandStatus:'COMMAND_NOT_SENT'});
 expect(plan.stops).toMatchObject(points.slice(1).map(p=>({order:p.order,kind:p.type,name:p.name,latitude:p.latitude,longitude:p.longitude})));expect(provider).toHaveBeenCalledOnce();
 const prepared=await a.post('navigation/preview',{ticket:plan.navigationTicket,vehicleType:'ice'});
 expect(prepared.status).toBe(200);expect(provider).toHaveBeenCalledOnce();
 expect((await prepared.json() as {stops:unknown[]}).stops).toEqual(plan.stops);
 const proof=await resolve(plan.navigationTicket,e.NAVIGATION_TICKET_SECRET),session=await new Sessions(e).open(a.id);
 expect(session.data.plan?.expires).toBeLessThanOrEqual(proof.expiresAt);
});
it('distinguishes a delayed provider from bad input and never retries Route automatically',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'}),c=await recommendation(e);
 vi.useFakeTimers();
 try{
  const provider=external((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('timeout')),{once:true})));
  const pending=call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e});
  while(!provider.mock.calls.length)await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(25001);
  const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:'ROAD_PROVIDER_TIMEOUT',roadVerified:false});expect(provider).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
it('coalesces concurrent verification, identifies an inaccessible point and allows manual retry',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'}),points=[point(0,'ORIGIN','공개 테스트 출발',35.1796,129.0756),point(1,'SCENIC_WAYPOINT','공개 테스트 해안',35.2,129.2),point(2,'DESTINATION','공개 테스트 도착',35.3,129.25),point(3,'RETURN','공개 테스트 복귀',35.1796,129.0756)];
 const route=finish(points,{legs:[],status:'ESTIMATED_NOT_ROAD_ROUTED',provider:'TEST_ONLY',geometryStatus:'NOT_AVAILABLE'},0,'UNAVAILABLE',[]);
 const ticket=await issue('dyn-test',route,e.NAVIGATION_TICKET_SECRET);
 let release!:(r:Response)=>void;
 const provider=external(()=>new Promise<Response>(resolve=>{release=resolve;}));
 const a=call('/api/navigation/verify',{ticket},{env:e}),b=call('/api/navigation/verify',{ticket},{env:e});
 while(!release)await new Promise(resolve=>setTimeout(resolve,1));
 await new Promise(resolve=>setTimeout(resolve,10));
 release(json({code:'NoSegment',message:'Could not find a matching segment for coordinate 1'},400));
 const results=await Promise.all([a,b]);expect(provider).toHaveBeenCalledOnce();
 for(const r of results){expect(r.status).toBe(400);expect(await r.json()).toMatchObject({error:'WAYPOINT_TOO_FAR_FROM_ROAD',courseId:'dyn-test',waypointOrders:[1]});}
 external(url=>{const coords=new URL(url).pathname.split('/').at(-1)!.split(';').map(v=>v.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map(()=>({distance:10000,duration:900}))}]});});
 expect((await call('/api/navigation/verify',{ticket},{env:e})).status).toBe(200);
});
async function recommendation(e=config(),extra={}){return (await recommendWithRouting(parseRecommendation.parse({...base,availableMinutes:1440,...extra}),{...e,ROAD_ROUTING_URL:undefined,OSRM_BATCH_URL:undefined})).courses[0];}
function roads(url:string){const u=new URL(url);expect(u.searchParams.get('steps')).toBe('false');expect(u.searchParams.get('overview')).toBe('false');expect(u.searchParams.get('radiuses')).toBe('100;100;100;100;100');const coords=u.pathname.split('/').at(-1)!.split(';').map(v=>v.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(c=>({distance:6,location:[c[0],c[1]+.00005]})),routes:[{legs:coords.slice(1).map(()=>({distance:30000,duration:1800}))}]});}
it('distinguishes an anonymous session from a connected account with no selected vehicle',async()=>{
 const e=config({TESLA_CLIENT_ID:'public',TESLA_CLIENT_SECRET:'public',TESLA_REDIRECT_URI:'https://flowad.test/api/tesla/callback',ROAD_ROUTING_URL:'https://roads.test'}),fn=external(roads),input={courseId:'yangpyeong',latitude:37.5665,longitude:126.978};
 const anonymous=await authenticated({tokens:undefined},e);expect(await(await anonymous.post('navigation/preview',input)).json()).toEqual({error:'NOT_CONNECTED'});
 const connected=await authenticated({selected:undefined},e);expect(await(await connected.post('navigation/preview',input)).json()).toEqual({error:'NO_VEHICLE_SELECTED'});expect(fn).not.toHaveBeenCalled();
});
it('does not return historical estimates when the public POI database is empty',async()=>{const fn=external(()=>{throw Error('unexpected provider call')});const r=await call('/api/recommendations',base,{env:config({ROAD_ROUTING_URL:'https://roads.test'})});expect(await r.json()).toMatchObject({courses:[],status:'NO_NEARBY_POIS'});expect(fn).not.toHaveBeenCalled();});
it('verifies one selected round trip, snaps points and issues a compatible verified ticket',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test',FREE_PLAN_MODE:'true'}),c=await recommendation(e,{returnLatitude:35.1796,returnLongitude:129.0756}),fn=external(roads);
 const r=await call('/api/navigation/verify',{ticket:c.navigationTicket,vehicleType:'ev',batteryPercent:70,estimatedRangeKm:400,availableMinutes:60},{env:e});expect(r.status).toBe(200);
 const v=await r.json() as {navigationTicket:string;route:{points:{latitude:number;longitude:number}[];distanceKm:number};roadVerified:boolean};expect(v).toMatchObject({verificationStatus:'ROAD_ROUTE_VERIFIED',roadVerified:true,batteryStatus:'ESTIMATED_SUFFICIENT',withinAvailableMinutes:false,route:{status:'ROAD_ROUTED',distanceKm:120}});expect(fn).toHaveBeenCalledTimes(1);
 expect(v.route.points[0].latitude).toBeCloseTo(base.latitude+.00005);expect(v.route.points.at(-1)?.longitude).toBe(129.0756);
 const snapshot=await resolve(v.navigationTicket,e.NAVIGATION_TICKET_SECRET);expect(snapshot.route.status).toBe('ROAD_ROUTED');expect(snapshot.route.points).toEqual(v.route.points);
 expect((await call('/api/navigation/resolve',{ticket:v.navigationTicket},{env:e})).status).toBe(200);
});
it.each(['NoSegment','NoRoute'])('keeps estimates available but rejects selected %s without a success ticket',async code=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'}),c=await recommendation(e);external(()=>json({code},400));
 const r=await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e});expect(await r.json()).toMatchObject({verificationStatus:'ROAD_ROUTE_UNAVAILABLE',roadVerified:false,error:code==='NoSegment'?'WAYPOINT_TOO_FAR_FROM_ROAD':'NO_ROAD_ROUTE'});
 const fn=external(()=>json({},503));expect((await recommendation(e)).route.status).toBe('ESTIMATED_NOT_ROAD_ROUTED');expect(fn).not.toHaveBeenCalled();
});
it('rejects a forged ticket without touching a provider',async()=>{const fn=external(roads);const r=await call('/api/navigation/verify',{ticket:'forged.signature'},{env:config({ROAD_ROUTING_URL:'https://roads.test'})});expect(await r.json()).toMatchObject({roadVerified:false,error:'INVALID_TICKET'});expect(fn).not.toHaveBeenCalled();});
it.each([429,503,403] as const)('reports provider HTTP %s as a dependency failure, not malformed client input',async status=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'}),c=await recommendation(e);
 const provider=external(()=>new Response('provider unavailable',{status,headers:{'Retry-After':'17'}}));
 const r=await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e});
 expect(r.status).toBe(503);expect(await r.json()).toEqual({verificationStatus:'ROAD_ROUTE_UNAVAILABLE',roadVerified:false,error:status===429?'ROAD_PROVIDER_RATE_LIMIT':status===403?'PROVIDER_PERMISSION_DENIED':'PROVIDER_UNAVAILABLE'});
 expect(r.headers.get('Retry-After')).toBe(status===429?'17':null);expect(provider).toHaveBeenCalledTimes(1);
});
it('keeps invalid input as 400 and provider transport failure as 503 without retrying',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'}),c=await recommendation(e),provider=external(()=>{throw Error('connection failed');});
 const invalid=await call('/api/navigation/verify',{ticket:c.navigationTicket,availableMinutes:0},{env:e});expect(invalid.status).toBe(400);expect(provider).not.toHaveBeenCalled();
 const failed=await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e});expect(failed.status).toBe(503);expect(await failed.json()).toMatchObject({roadVerified:false,error:'PROVIDER_UNAVAILABLE'});expect(provider).toHaveBeenCalledTimes(1);
});
it('keeps the100m snap limit and rejects a selected provider outage',async()=>{const e=config({ROAD_ROUTING_URL:'https://roads.test'}),c=await recommendation(e);external(url=>{const response=roads(url);return response.json().then((v:unknown)=>{const data=v as {waypoints:{distance:number}[]};data.waypoints[0].distance=101;return json(data);});});expect(await(await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e})).json()).toMatchObject({roadVerified:false,error:'WAYPOINT_TOO_FAR_FROM_ROAD'});external(()=>{throw Error('network timeout');});expect(await(await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e})).json()).toMatchObject({roadVerified:false,error:'PROVIDER_UNAVAILABLE'});});

it('recovers the same itinerary after a provider cooldown outlives the navigation ticket',async()=>{
 const env=config({ROAD_ROUTING_URL:'https://recovery.test'});
 const started=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(started);
 const points=[point(0,'ORIGIN','공개 출발',35.18,129.07),point(1,'SCENIC_WAYPOINT','공개 경유',35.2,129.2),point(2,'DESTINATION','공개 목적지',35.3,129.25),point(3,'RETURN','공개 복귀',35.18,129.07)];
 const candidate=finish(points,{legs:[],status:'ESTIMATED_NOT_ROAD_ROUTED',provider:'TEST',geometryStatus:'NOT_AVAILABLE'},0,'UNAVAILABLE',[]);
 const tokens=await issueCourseCredentials('dyn-recovery',candidate,env.NAVIGATION_TICKET_SECRET);
 const verify=(body:Record<string,unknown>)=>call('/api/navigation/verify',body,{env});
 const throttled=external(()=>new Response('Busy',{status:429,headers:{'Retry-After':'120'}}));
 expect((await verify({ticket:tokens.navigationTicket,selectionToken:tokens.selectionToken})).status).toBe(400);
 expect((await call('/api/navigation/resolve',{ticket:tokens.selectionToken},{env})).status).toBe(400);
 expect(await(await verify({selectionToken:tokens.navigationTicket})).json()).toMatchObject({error:'INVALID_SELECTION'});
 expect(throttled).not.toHaveBeenCalled();
 clock.mockReturnValue(started+295000);
 const first=await verify({selectionToken:tokens.selectionToken});
 expect(first.status).toBe(503);
 expect(first.headers.get('Retry-After')).toBe('120');
 expect(await first.json()).toMatchObject({roadVerified:false,error:'ROAD_PROVIDER_RATE_LIMIT'});
 clock.mockReturnValue(started+301000);
 expect(await(await verify({ticket:tokens.navigationTicket})).json()).toMatchObject({error:'TICKET_EXPIRED'});
 const blocked=await verify({selectionToken:tokens.selectionToken});
 expect(blocked.headers.get('Retry-After')).toBe('114');
 expect(throttled).toHaveBeenCalledOnce();
 clock.mockReturnValue(started+415000);
 const provider=external(url=>{
  const path=new URL(url);
  expect(path.searchParams.get('radiuses')).toBe('100;100;100;100');
  expect(path.pathname.split('/').at(-1)).toBe(points.map(p=>p.longitude+','+p.latitude).join(';'));
  return json({code:'Ok',waypoints:points.map(p=>({distance:0,location:[p.longitude,p.latitude]})),routes:[{legs:points.slice(1).map(()=>({distance:10000,duration:600}))}]});
 });
 const success=await verify({selectionToken:tokens.selectionToken});
 const data=await success.json() as {roadVerified:boolean;navigationTicket:string};
 expect(success.status).toBe(200);
 expect(data.roadVerified).toBe(true);
 const proof=await resolve(data.navigationTicket,env.NAVIGATION_TICKET_SECRET);
 expect(proof.route.points).toEqual(points);
 expect(proof.expiresAt-now()).toBe(300);
 clock.mockReturnValue(started+1800000);
 expect(await(await verify({selectionToken:tokens.selectionToken})).json()).toMatchObject({error:'SELECTION_EXPIRED'});
 expect(provider).toHaveBeenCalledOnce();
});
it('invalidates an old unsent Tesla plan if the next selected verification fails',async()=>{
 const a=await authenticated({},config({TESLA_CLIENT_ID:'public',TESLA_CLIENT_SECRET:'public',TESLA_REDIRECT_URI:'https://flowad.test/api/tesla/callback',ROAD_ROUTING_URL:'https://roads.test'}));
 const l=await new Sessions(a.env).open(a.id);l.data.plan={id:'old',vehicle:'car',expires:now()+300,stops:[],attempted:0,status:'NOT_SENT',vehicleStatus:'VEHICLE_NOT_CONFIRMED',pending:false,roadVerified:true};await l.save(true);
 external(()=>json({code:'NoSegment'},400));await a.post('navigation/preview',{courseId:'yangpyeong',latitude:37.5665,longitude:126.978});
 const fn=external(()=>json({}));expect(await(await a.post('navigation/send',{planId:'old',order:1,replaceDestination:true})).json()).toEqual({error:'PLAN_EXPIRED'});expect(fn).not.toHaveBeenCalled();
});
