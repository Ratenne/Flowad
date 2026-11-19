import {it,expect,vi} from 'vitest';
import {call,base,config,external,json} from './helpers';
import {distance} from '../src/utils';
import {resolve} from '../src/tickets';
import {nearby} from '../src/poi';
const cities=[['서울',37.5665,126.978],['부산',35.1796,129.0756],['대구',35.8714,128.6014],['제주',33.4996,126.5312],['강원',37.74,128.75],['저밀도',34.9,126.4]] as const;
async function seed(){
 const db=config().DB,at='2026-11-01T00:00:00Z';
 await db.prepare('INSERT INTO poi_datasets VALUES(?,?,?,?,?,?)').bind('fixture','FIXTURE',at,at,'SYNTHETIC TEST ONLY','COMPLETE').run();
 await db.prepare('INSERT INTO poi_provider_state VALUES(?,?)').bind('FIXTURE','fixture').run();
 for(const [city,lat,lng] of cities)for(let i=0;i<6;i++){
  const id=`fixture:${city}:${i}`,x=lat+.025*(i+1),y=lng+(i%2?-.025:.025)*(i+1),mood=i%2?'forest':'coast';
  await db.prepare('INSERT INTO pois(dataset_id,id,provider,source_id,name,normalized_name,latitude,longitude,category,scenery,region,quality,access_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('fixture',id,'FIXTURE',id,city+' 테스트 '+i,id,x,y,i%2?'park':'beach',mood,city,'NAMED_COORDINATE','POSSIBLE_ACCESS',at,at).run();
  await db.prepare('INSERT INTO poi_sources VALUES(?,?,?,?,?,?,?)').bind('fixture',id,'FIXTURE',id,'{}',at,'SYNTHETIC TEST ONLY').run();
  await db.prepare('INSERT INTO poi_access_points VALUES(?,?,?,?,?,?,?,?)').bind('fixture',id,'ROAD_CANDIDATE',x,y,'POSSIBLE_ACCESS','FIXTURE',null).run();
 }
}
function mockRoads(rejectFirst=false){return external(url=>{
 const u=new URL(url),coords=u.pathname.split('/').at(-1)!.split(';').map(v=>v.split(',').map(Number));
 const meters=(a:number[],b:number[])=>distance(a[1],a[0],b[1],b[0])*1300;
 if(u.pathname.includes('/table/'))return json({code:'Ok',sources:coords.map((location,i)=>({location,distance:rejectFirst&&i===1?563:0})),durations:coords.map(a=>coords.map(b=>meters(a,b)/14)),distances:coords.map(a=>coords.map(b=>meters(a,b)))});
 return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map((b,i)=>({distance:meters(coords[i],b),duration:meters(coords[i],b)/14,steps:[{geometry:{coordinates:[coords[i],b]}}]}))}]});
});}
it('shares identical pending conditions across different request IDs',async()=>{
 await seed();const e=config({ROAD_ROUTING_URL:'https://roads.test'}),roads=mockRoads();
 const responses=await Promise.all(['request-one','request-two'].map(requestId=>call('/api/recommendations',{...base,requestId},{env:e})));
 expect(responses.map(r=>r.status)).toEqual([200,200]);
 expect(await responses[0].json()).toEqual(await responses[1].json());expect(roads).not.toHaveBeenCalled();
 expect((await e.DB.prepare('SELECT * FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
});
it('returns recommendations without calling a rate-limited provider',async()=>{
 await seed();vi.spyOn(console,'error').mockImplementation(()=>{});const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const provider=external(()=>new Response('rate limited',{status:429,headers:{'Retry-After':'17'}}));
 const response=await call('/api/recommendations',base,{env:e});
 expect(response.status).toBe(200);expect(response.headers.get('Retry-After')).toBeNull();
 expect(await response.json()).toMatchObject({status:'ESTIMATED_NOT_ROAD_ROUTED',diagnostics:{tableCalls:0,routeCalls:0}});expect(provider).not.toHaveBeenCalled();
 expect((await e.DB.prepare('SELECT * FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
});
it('isolates a selected Route challenge from basic discovery',async()=>{
 await seed();const e=config({ROAD_ROUTING_URL:'https://roads.test'}),roads=mockRoads();
 let routeCalls=0;
 external(url=>{
  if(url.includes('/table/'))return roads(url);
  routeCalls++;return new Response('private challenge tokens',{status:429,headers:{'cf-mitigated':'challenge'}});
 });
 const response=await call('/api/recommendations',base,{env:e});
 expect(response.status).toBe(200);const data=await response.json() as {courses:Array<{navigationTicket:string}>};expect(data.courses.length).toBeGreaterThan(0);expect(routeCalls).toBe(0);
 const verified=await call('/api/navigation/verify',{ticket:data.courses[0].navigationTicket},{env:e});
 expect(verified.status).toBe(503);expect(await verified.json()).toMatchObject({error:'ROAD_PROVIDER_CHALLENGE',roadVerified:false});expect(routeCalls).toBe(1);
 expect((await e.DB.prepare('SELECT * FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
});
it('does not claim road access or geometry before selected-course verification',async()=>{
 await seed();const roads=mockRoads(true),e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const response=await call('/api/recommendations',{...base,vehicleType:'ice'},{env:e});
 expect(response.status).toBe(200);
 const data=await response.json() as {courses:Array<{waypoints:Array<{id:string}>;route:{status:string}}>};
 expect(data.courses.length).toBeGreaterThan(0);
 for(const c of data.courses)expect(c.route.status).toBe('ESTIMATED_NOT_ROAD_ROUTED');
 expect(roads).not.toHaveBeenCalled();
});
it.each(cities)('generates dynamic routes around %s with bounded D1/Table/Route work',async(_city,latitude,longitude)=>{
 await seed();const roads=mockRoads(),e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const response=await call('/api/recommendations',{...base,latitude,longitude,vehicleType:'ice'},{env:e});
 expect(response.status).toBe(200);
 const data=await response.json() as {courses:Array<{id:string;score:number;navigationTicket:string;estimatedMinutes:number;route:{points:unknown[];status:string}}> ;diagnostics:{tableCalls:number;routeCalls:number;poiQueries:number}};
 expect(data.courses.length).toBeGreaterThanOrEqual(3);expect(data.courses.length).toBeLessThanOrEqual(5);
 expect(data.diagnostics.tableCalls).toBe(0);expect(data.diagnostics.routeCalls).toBe(0);expect(data.diagnostics.poiQueries).toBeLessThanOrEqual(3);expect(roads).not.toHaveBeenCalled();
 for(const course of data.courses){expect(course.id).toMatch(/^dyn-/);expect(course.estimatedMinutes).toBeLessThanOrEqual(180);expect(course.score).toBeGreaterThanOrEqual(0);expect(course.score).toBeLessThanOrEqual(100);expect(course.route.status).toBe('ESTIMATED_NOT_ROAD_ROUTED');const ticket=await resolve(course.navigationTicket,e.NAVIGATION_TICKET_SECRET);expect(ticket.route.points).toEqual(course.route.points);}
 expect(new Set(data.courses.map(c=>c.id)).size).toBe(data.courses.length);
});
it('RTree excludes remote/deleted/private candidates without a table scan',async()=>{
 await seed();const db=config().DB;
 await db.prepare("UPDATE pois SET access_status='NO_CAR_ACCESS' WHERE id LIKE '%서울:0'").run();
 const result=await nearby(config(),37.5665,126.978,30);
 expect(result.length).toBe(5);expect(result.every(p=>p.region==='서울')).toBe(true);
 const plan=await db.prepare('EXPLAIN QUERY PLAN SELECT * FROM poi_spatial WHERE min_lat<38 AND max_lat>37 AND min_lon<128 AND max_lon>126').all<{detail:string}>();
 expect(plan.results.some(r=>r.detail.includes('VIRTUAL TABLE INDEX'))).toBe(true);
});
it('reads the same public POIs through spatial cell pages without scanning the national catalog',async()=>{
 await seed();const e=config(),db=e.DB;
 const rows=await db.prepare(`SELECT p.*,s.source_updated_at,s.attributes_json,a.latitude access_latitude,a.longitude access_longitude,a.kind access_kind FROM pois p JOIN poi_sources s ON s.poi_id=p.id JOIN poi_access_points a ON a.poi_id=p.id WHERE p.region='서울'`).all();
 await db.prepare("INSERT INTO poi_storage VALUES('fixture','CELLS',6)").run();
 await db.prepare('INSERT INTO poi_cells VALUES(?,?,?,?,?,?,?)').bind('fixture','seoul',37.5,38,126.7,127.3,JSON.stringify(rows.results)).run();
 const result=await nearby(e,37.5665,126.978,30);
 expect(result).toHaveLength(6);expect(result.every(p=>p.region==='서울'&&p.access_kind==='ROAD_CANDIDATE')).toBe(true);
 const plan=await db.prepare('EXPLAIN QUERY PLAN SELECT * FROM poi_cell_spatial WHERE min_lat<38 AND max_lat>37 AND min_lon<128 AND max_lon>126').all<{detail:string}>();
 expect(plan.results.some(r=>r.detail.includes('VIRTUAL TABLE INDEX'))).toBe(true);
});
it('does not fabricate routes when data, road provider or time budget is insufficient',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'});const roads=mockRoads();
 expect(await(await call('/api/recommendations',base,{env:e})).json()).toMatchObject({courses:[],status:'NO_NEARBY_POIS'});expect(roads).not.toHaveBeenCalled();
 await seed();expect(await(await call('/api/recommendations',{...base,availableMinutes:1},{env:e})).json()).toMatchObject({courses:[],status:'NO_FEASIBLE_ROUTE'});
 const unavailable=external(()=>json({code:'NoRoute'},503));expect((await call('/api/recommendations',base,{env:e})).status).toBe(200);expect(unavailable).not.toHaveBeenCalled();
});
it('includes a reachable outer driving area instead of only adjacent city-centre POIs',async()=>{
 await seed();const e=config({ROAD_ROUTING_URL:'https://roads.test'}),db=e.DB;
 await db.prepare("UPDATE pois SET latitude=37.9,longitude=127.1 WHERE id='fixture:서울:5'").run();
 await db.prepare("UPDATE poi_access_points SET latitude=37.9,longitude=127.1 WHERE poi_id='fixture:서울:5'").run();
 const roads=mockRoads(),response=await call('/api/recommendations',{...base,vehicleType:'ice'},{env:e});
 const data=await response.json() as {courses:Array<{waypoints:Array<{id:string}>}>};
 expect(response.status).toBe(200);expect(data.courses.some(c=>c.waypoints.some(p=>p.id==='fixture:서울:5'))).toBe(true);expect(roads).not.toHaveBeenCalled();
});
it('keeps severe-weather, walking, scenery and EV conditions on dynamic candidates',async()=>{
 await seed();mockRoads();const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 expect(await(await call('/api/recommendations',{...base,originSevere:true},{env:e})).json()).toMatchObject({courses:[],status:'WEATHER_UNSAFE'});
 const data=await(await call('/api/recommendations',{...base,walking:false,batteryPercent:1,estimatedRangeKm:100,roundTrip:false},{env:e})).json() as {courses:Array<{batteryStatus:string;stopMinutes:number;waypoints:unknown[];route:{points:Array<{type:string}>}}>};
 expect(data.courses.length).toBeGreaterThan(0);
 for(const c of data.courses){expect(c.batteryStatus).toBe('CHARGING_MAY_BE_NEEDED');expect(c.stopMinutes).toBe(c.waypoints.length*10);expect(c.route.points.at(-1)?.type).toBe('DESTINATION');}
});
it('revalidates signed dynamic coordinates for vehicle preview without catalog IDs',async()=>{
 await seed();const roads=mockRoads(),e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const data=await(await call('/api/recommendations',base,{env:e})).json() as {courses:Array<{navigationTicket:string;id:string}>};
 const r=await call('/api/navigation/verify',{ticket:data.courses[0].navigationTicket,vehicleType:'ice',availableMinutes:180},{env:e});
 expect(r.status).toBe(200);const body=await r.json() as {roadVerified:boolean;navigationTicket:string};expect(body.roadVerified).toBe(true);expect((await resolve(body.navigationTicket,e.NAVIGATION_TICKET_SECRET)).courseId).toBe(data.courses[0].id);
 expect(roads).toHaveBeenCalledTimes(1);const url=new URL(String(roads.mock.calls[0][0]));expect(url.searchParams.get('steps')).toBe('false');expect(url.searchParams.get('overview')).toBe('false');
});
it('discovers without any configured road provider and never invents road geometry',async()=>{
 await seed();const provider=external(()=>{throw Error('No external requests allowed');}),e=config({ROAD_ROUTING_URL:''});
 const response=await call('/api/recommendations',base,{env:e});expect(response.status).toBe(200);
 const data=await response.json() as {courses:Array<{navigationTicket:string;vehicleTransferAllowed:boolean;route:{geometryStatus:string;legs:Array<{geometry:unknown}>}}>};
 expect(data.courses).toHaveLength(5);expect(provider).not.toHaveBeenCalled();
 for(const c of data.courses){expect(c.vehicleTransferAllowed).toBe(false);expect(c.route.geometryStatus).toBe('NOT_AVAILABLE');expect(c.route.legs.every(l=>l.geometry===null)).toBe(true);}
 const verified=await call('/api/navigation/verify',{ticket:data.courses[0].navigationTicket},{env:e});
 expect(await verified.json()).toMatchObject({roadVerified:false,error:'ROAD_ROUTE_REQUIRED'});expect(provider).not.toHaveBeenCalled();
});
it('rejects an unsnappable selected POI without suppressing discovery',async()=>{
 await seed();const e=config({ROAD_ROUTING_URL:'https://roads.test'}),roads=mockRoads();
 const data=await(await call('/api/recommendations',base,{env:e})).json() as {courses:Array<{navigationTicket:string}>};expect(roads).not.toHaveBeenCalled();
 external(url=>{const u=new URL(url),coords=u.pathname.split('/').at(-1)!.split(';').map(v=>v.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:500})),routes:[{legs:coords.slice(1).map(()=>({distance:1000,duration:100}))}]});});
 const verified=await call('/api/navigation/verify',{ticket:data.courses[0].navigationTicket},{env:e});
 expect(await verified.json()).toMatchObject({roadVerified:false,error:'WAYPOINT_TOO_FAR_FROM_ROAD'});
 expect((await call('/api/recommendations',base,{env:e})).status).toBe(200);
});
