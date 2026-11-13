import {it,expect} from 'vitest';
import {call,base,config,external,json,authenticated} from './helpers';
import {resolve} from '../src/tickets';
import {Sessions} from '../src/repository';
import {now} from '../src/utils';
async function recommendation(e=config(),extra={}){const r=await call('/api/recommendations',{...base,availableMinutes:1440,...extra},{env:e});return (await r.json() as {courses:{id:string;navigationTicket:string;route:{status:string}}[]}).courses[0];}
function roads(url:string){const u=new URL(url);expect(u.searchParams.get('steps')).toBe('false');expect(u.searchParams.get('overview')).toBe('false');expect(u.searchParams.get('radiuses')).toBe('100;100;100;100;100');const coords=u.pathname.split('/').at(-1)!.split(';').map(v=>v.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(c=>({distance:6,location:[c[0],c[1]+.00005]})),routes:[{legs:coords.slice(1).map(()=>({distance:30000,duration:1800}))}]});}
it('does not call OSRM or batch for any of ten candidates even when both are configured',async()=>{
 const fn=external(()=>{throw Error('provider unavailable');}),e=config({ROAD_ROUTING_URL:'https://roads.test',OSRM_BATCH_URL:'https://batch.test',FREE_PLAN_MODE:'true'});
 const c=await recommendation(e);expect(c.route.status).toBe('ESTIMATED_NOT_ROAD_ROUTED');expect(fn).not.toHaveBeenCalled();expect((await resolve(c.navigationTicket,e.NAVIGATION_TICKET_SECRET)).route.status).toBe('ESTIMATED_NOT_ROAD_ROUTED');
 const r=await call('/api/recommendations',{...base,availableMinutes:1},{env:e});expect(await r.json()).toMatchObject({timeExcluded:10,routingFailed:0});expect(fn).not.toHaveBeenCalled();
});
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
it('keeps the100m snap limit and rejects a selected provider outage',async()=>{const e=config({ROAD_ROUTING_URL:'https://roads.test'}),c=await recommendation(e);external(url=>{const response=roads(url);return response.json().then((v:unknown)=>{const data=v as {waypoints:{distance:number}[]};data.waypoints[0].distance=101;return json(data);});});expect(await(await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e})).json()).toMatchObject({roadVerified:false,error:'WAYPOINT_TOO_FAR_FROM_ROAD'});external(()=>{throw Error('network timeout');});expect(await(await call('/api/navigation/verify',{ticket:c.navigationTicket},{env:e})).json()).toMatchObject({roadVerified:false,error:'PROVIDER_UNAVAILABLE'});});
it('invalidates an old unsent Tesla plan if the next selected verification fails',async()=>{
 const a=await authenticated({},config({TESLA_CLIENT_ID:'public',TESLA_CLIENT_SECRET:'public',TESLA_REDIRECT_URI:'https://flowad.test/api/tesla/callback',ROAD_ROUTING_URL:'https://roads.test'}));
 const l=await new Sessions(a.env).open(a.id);l.data.plan={id:'old',vehicle:'car',expires:now()+300,stops:[],attempted:0,status:'NOT_SENT',vehicleStatus:'VEHICLE_NOT_CONFIRMED',pending:false,roadVerified:true};await l.save(true);
 external(()=>json({code:'NoSegment'},400));await a.post('navigation/preview',{courseId:'yangpyeong',latitude:37.5665,longitude:126.978});
 const fn=external(()=>json({}));expect(await(await a.post('navigation/send',{planId:'old',order:1,replaceDestination:true})).json()).toEqual({error:'PLAN_EXPIRED'});expect(fn).not.toHaveBeenCalled();
});
