import {it,expect,vi} from 'vitest';
import {call,base,config,external,json} from './helpers';
import {distance,now} from '../src/utils';
import {dynamicPolicy} from '../src/dynamic-recommendations';
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
 let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 external(async url=>{if(url.includes('/table/')){entered();await gate;}return roads(url);});
 const first=call('/api/recommendations',{...base,requestId:'request-one'},{env:e});await started;
 const leased=await e.DB.prepare('SELECT expires FROM poi_routing_slots WHERE expires>0').first<{expires:number}>();
 expect(leased!.expires-now()).toBeGreaterThanOrEqual(Math.ceil(dynamicPolicy.totalMs/1000));
 const second=call('/api/recommendations',{...base,requestId:'request-two'},{env:e});
 await new Promise(r=>setTimeout(r,100));release();
 const responses=await Promise.all([first,second]);expect(responses.map(r=>r.status)).toEqual([200,200]);
 expect(roads.mock.calls.filter(([url])=>String(url).includes('/table/'))).toHaveLength(1);
 expect((await e.DB.prepare('SELECT * FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
});
it('returns a retry delay for provider throttling and releases the routing lease',async()=>{
 await seed();vi.spyOn(console,'error').mockImplementation(()=>{});const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 external(()=>new Response('rate limited',{status:429,headers:{'Retry-After':'17'}}));
 const response=await call('/api/recommendations',base,{env:e});
 expect(response.status).toBe(503);expect(response.headers.get('Retry-After')).toBe('17');
 expect(await response.json()).toMatchObject({error:'ROAD_PROVIDER_RATE_LIMIT'});
 expect((await e.DB.prepare('SELECT * FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
});
it('stops after a Route challenge instead of issuing the remaining candidate requests',async()=>{
 await seed();const e=config({ROAD_ROUTING_URL:'https://roads.test'}),roads=mockRoads();
 let routeCalls=0;
 external(url=>{
  if(url.includes('/table/'))return roads(url);
  routeCalls++;return new Response('private challenge tokens',{status:429,headers:{'cf-mitigated':'challenge'}});
 });
 const response=await call('/api/recommendations',base,{env:e});
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:'ROAD_PROVIDER_CHALLENGE'});
 expect(response.headers.get('Retry-After')).toBeNull();expect(routeCalls).toBe(1);
 expect((await e.DB.prepare('SELECT * FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
});
it('keeps valid road courses when one unverified POI cannot snap within 100m',async()=>{
 await seed();const roads=mockRoads(true),e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const response=await call('/api/recommendations',{...base,vehicleType:'ice'},{env:e});
 expect(response.status).toBe(200);
 const data=await response.json() as {courses:Array<{waypoints:Array<{id:string}>;route:{status:string}}>};
 expect(data.courses.length).toBeGreaterThan(0);
 for(const c of data.courses){expect(c.route.status).toBe('ROAD_ROUTED');expect(c.waypoints.every(p=>p.id!=='fixture:서울:0')).toBe(true);}
 expect(roads.mock.calls.filter(([url])=>String(url).includes('/table/'))).toHaveLength(1);
 expect(roads.mock.calls.length).toBeLessThanOrEqual(6);
});
it.each(cities)('generates dynamic routes around %s with bounded D1/Table/Route work',async(_city,latitude,longitude)=>{
 await seed();const roads=mockRoads(),e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const response=await call('/api/recommendations',{...base,latitude,longitude,vehicleType:'ice'},{env:e});
 expect(response.status).toBe(200);
 const data=await response.json() as {courses:Array<{id:string;score:number;navigationTicket:string;estimatedMinutes:number;route:{points:unknown[];status:string}}> ;diagnostics:{tableCalls:number;routeCalls:number;poiQueries:number}};
 expect(data.courses.length).toBeGreaterThanOrEqual(3);expect(data.courses.length).toBeLessThanOrEqual(5);
 expect(data.diagnostics.tableCalls).toBe(1);expect(data.diagnostics.routeCalls).toBeLessThanOrEqual(5);expect(data.diagnostics.poiQueries).toBeLessThanOrEqual(3);expect(roads.mock.calls.length).toBeLessThanOrEqual(6);
 for(const course of data.courses){expect(course.id).toMatch(/^dyn-/);expect(course.estimatedMinutes).toBeLessThanOrEqual(180);expect(course.score).toBeGreaterThanOrEqual(0);expect(course.score).toBeLessThanOrEqual(100);expect(course.route.status).toBe('ROAD_ROUTED');const ticket=await resolve(course.navigationTicket,e.NAVIGATION_TICKET_SECRET);expect(ticket.route.points).toEqual(course.route.points);}
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
 external(()=>json({code:'NoRoute'},503));expect((await call('/api/recommendations',base,{env:e})).status).toBe(503);
});
it('includes a reachable outer driving area instead of only adjacent city-centre POIs',async()=>{
 await seed();const e=config({ROAD_ROUTING_URL:'https://roads.test'}),db=e.DB;
 await db.prepare("UPDATE pois SET latitude=37.9,longitude=127.1 WHERE id='fixture:서울:5'").run();
 await db.prepare("UPDATE poi_access_points SET latitude=37.9,longitude=127.1 WHERE poi_id='fixture:서울:5'").run();
 const roads=mockRoads(),response=await call('/api/recommendations',{...base,vehicleType:'ice'},{env:e});
 expect(response.status).toBe(200);expect(roads.mock.calls.some(c=>String(c[0]).includes('127.1,37.9'))).toBe(true);
});
it('keeps severe-weather, walking, scenery and EV conditions on dynamic candidates',async()=>{
 await seed();mockRoads();const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 expect(await(await call('/api/recommendations',{...base,originSevere:true},{env:e})).json()).toMatchObject({courses:[],status:'WEATHER_UNSAFE'});
 const data=await(await call('/api/recommendations',{...base,walking:false,batteryPercent:1,estimatedRangeKm:100,roundTrip:false},{env:e})).json() as {courses:Array<{batteryStatus:string;stopMinutes:number;waypoints:unknown[];route:{points:Array<{type:string}>}}>};
 expect(data.courses.length).toBeGreaterThan(0);
 for(const c of data.courses){expect(c.batteryStatus).toBe('CHARGING_MAY_BE_NEEDED');expect(c.stopMinutes).toBe(c.waypoints.length*10);expect(c.route.points.at(-1)?.type).toBe('DESTINATION');}
});
it('revalidates signed dynamic coordinates for vehicle preview without catalog IDs',async()=>{
 await seed();mockRoads();const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 const data=await(await call('/api/recommendations',base,{env:e})).json() as {courses:Array<{navigationTicket:string;id:string}>};
 const r=await call('/api/navigation/verify',{ticket:data.courses[0].navigationTicket,vehicleType:'ice',availableMinutes:180},{env:e});
 expect(r.status).toBe(200);const body=await r.json() as {roadVerified:boolean;navigationTicket:string};expect(body.roadVerified).toBe(true);expect((await resolve(body.navigationTicket,e.NAVIGATION_TICKET_SECRET)).courseId).toBe(data.courses[0].id);
});
