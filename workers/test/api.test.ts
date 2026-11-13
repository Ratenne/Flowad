import { describe,it,expect } from 'vitest';
import { call,base,config,external,json } from './helpers';
import { coordinate } from '../src/utils';
import { route, destination } from '../src/routing';
import { resolve } from '../src/tickets';
import { quota } from '../src/repository';
describe('API contracts and recommendation engine in workerd',()=>{
  it('returns three courses, unchanged route/EV limitation, and resolvable Pleos snapshot',async()=>{
    const r=await call('/api/recommendations',base);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');
    const data=await r.json() as {courses:{id:string;batteryStatus:string;distanceTimeStatus:string;route:{points:unknown[]};navigationTicket:string}[]};
    expect(data.courses).toHaveLength(3);
    for(const c of data.courses){expect(c.batteryStatus).toBe('ROAD_ROUTE_REQUIRED');expect(c.distanceTimeStatus).toBe('ESTIMATED_NOT_ROAD_ROUTED');expect(c.route.points.length).toBeGreaterThan(3);const resolved=await resolve(c.navigationTicket,config().NAVIGATION_TICKET_SECRET);expect(resolved.courseId).toBe(c.id);expect(resolved.route.points).toEqual(c.route.points);}
    const resolveResponse=await call('/api/navigation/resolve',{ticket:data.courses[0].navigationTicket});expect(resolveResponse.status).toBe(200);
  });
  it.each([{}, {...base,latitude:91},{...base,longitude:181},{...base,availableMinutes:0},{...base,returnLatitude:38},{...base,weather:{condition:'sunny'}}])('returns legacy 400 for invalid recommendation %#',async body=>{const r=await call('/api/recommendations',body);expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'Invalid recommendation request'});});
  it('handles malformed JSON without exposing details',async()=>{const worker=(await import('../src/index')).default;const r=await worker.fetch(new Request('https://flowad.test/api/recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),config(),{} as ExecutionContext);expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'Invalid recommendation request'});});
  it('keeps weather filtering and time exclusion',async()=>{const r=await call('/api/recommendations',{...base,originSevere:true});expect(await r.json()).toMatchObject({courses:[],weatherExcluded:10});const short=await call('/api/recommendations',{...base,availableMinutes:1});expect(await short.json()).toMatchObject({courses:[],timeExcluded:10});});
  it('keeps course-specific weather, walking and independent return coordinate behavior',async()=>{const r=await call('/api/recommendations',{...base,availableMinutes:1440,walking:false,vehicleType:'ice',returnLatitude:35.1796,returnLongitude:129.0756,courseWeather:{yangpyeong:{condition:'sunny',temperatureC:22,windMps:2,source:'test',severe:true}}});const d=await r.json() as {weatherExcluded:number;courses:{batteryStatus:string;route:{points:{latitude:number}[]}}[]};expect(d.weatherExcluded).toBe(1);for(const c of d.courses){expect(c.batteryStatus).toBe('NOT_APPLICABLE');expect(c.route.points.at(-1)?.latitude).toBe(35.1796);}});
  it('supports original context prefix and rejects invalid tickets with empty 400',async()=>{const e=config({API_PREFIX:'/flowad'});expect((await call('/flowad/api/recommendations',base,{env:e})).status).toBe(200);const bad=await call('/api/navigation/resolve',{ticket:'tampered'});expect(bad.status).toBe(400);expect(await bad.text()).toBe('');});
  it('preserves charging mock labels and road requirement',async()=>{expect(await(await call('/api/charging/recommendations',{})).json()).toMatchObject({status:'ROAD_ROUTE_REQUIRED',stations:[]});const r=await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry:[{latitude:37.56,longitude:127},{latitude:37.57,longitude:127}]});expect(await r.json()).toMatchObject({status:'MOCK_ONLY',stations:[{source:'MOCK_FICTITIOUS'}]});});
  it('rejects nonfinite/out-of-range charging coordinates',async()=>{expect(coordinate.safeParse({latitude:Infinity,longitude:0}).success).toBe(false);expect((await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry:[{latitude:91,longitude:0},{latitude:1,longitude:1}]})).status).toBe(400);});
  it('preserves exact charging proximity semantics for large, distinct geometry after CPU optimization',async()=>{
    const {distance}=await import('../src/utils');const geometry=Array.from({length:20000},(_,i)=>({latitude:37.65+i/1000000,longitude:127+i/1000000}));
    const r=await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry});expect(r.status).toBe(200);
    const d=await r.json() as {stations:{name:string;straightLineProximity:string}[]};
    const expected=[{name:'모의 충전소 A',latitude:37.56,longitude:127},{name:'모의 충전소 B',latitude:37.74,longitude:127.4}].flatMap(s=>{let nearest=Infinity;for(const p of geometry)nearest=Math.min(nearest,distance(p.latitude,p.longitude,s.latitude,s.longitude));return nearest<=15?[{name:s.name,straightLineProximity:`경로 좌표와 직선거리 약 ${Math.round(nearest)}km (이탈거리 아님)`}]:[];});
    expect(d.stations.map(s=>({name:s.name,straightLineProximity:s.straightLineProximity}))).toEqual(expected);
    expect((await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry:[...geometry,{latitude:'37',longitude:127}]})).status).toBe(400);
  });
  it('enforces exact CORS origins and bounded body size',async()=>{expect((await call('/api/recommendations',base,{headers:{Origin:'https://evil.test'}})).status).toBe(403);const good=await call('/api/recommendations',base,{headers:{Origin:'https://ravirgo.com'},env:config({ALLOWED_ORIGINS:'https://ravirgo.com'})});expect(good.headers.get('Access-Control-Allow-Origin')).toBe('https://ravirgo.com');expect((await call('/api/recommendations',{value:'x'.repeat(2_000_001)})).status).toBe(413);});
  it('keeps base recommendations independent of a failed configured provider',async()=>{await expect(destination('test',37,127,38,128,config())).rejects.toMatchObject({code:'ROAD_ROUTE_REQUIRED'});const fn=external(()=>json({},503));const r=await call('/api/recommendations',base,{env:config({ROAD_ROUTING_URL:'https://roads.test',OSRM_BATCH_URL:'https://batch.test',FREE_PLAN_MODE:'true'})});expect(await r.json()).toMatchObject({routingFailed:0,courses:expect.any(Array)});expect(fn).not.toHaveBeenCalled();});
  it('validates OSRM snapping, geometry and leg count',async()=>{
    const e=config({ROAD_ROUTING_URL:'https://roads.test'});
    external(url=>{const coords=new URL(url).pathname.split('/').at(-1)!.split(';').map(s=>s.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map((b,i)=>({distance:1000,duration:60,steps:[{geometry:{coordinates:[coords[i],b]}}]}))}]});});
    const r=await route('yangpyeong',37.5665,126.978,37.5665,126.978,15,e);expect(r.status).toBe('ROAD_ROUTED');expect(r.legs).toHaveLength(4);expect(r.distanceKm).toBe(4);
    external(()=>json({code:'Ok',waypoints:[],routes:[{legs:[]}]}));await expect(route('yangpyeong',37,127,37,127,15,e)).rejects.toMatchObject({code:'INCOMPLETE_ROUTE'});
  });
  it('keeps real distances and snapping with an explicit geometry omission in free mode',async()=>{
    const e=config({ROAD_ROUTING_URL:'https://roads.test',FREE_PLAN_MODE:'true'});
    external(url=>{expect(new URL(url).searchParams.get('steps')).toBe('false');const coords=new URL(url).pathname.split('/').at(-1)!.split(';').map(s=>s.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map(()=>({distance:1000,duration:60}))}]});});
    const r=await route('yangpyeong',37.5665,126.978,37.5665,126.978,15,e);expect(r.status).toBe('ROAD_ROUTED');expect(r.distanceKm).toBe(4);expect(r.geometryStatus).toBe('NOT_REQUESTED_FREE_PLAN');expect(r.legs.every(l=>l.geometry===null)).toBe(true);expect(r.warnings.at(-1)).toContain('거리·시간은 실제 도로 제공자 응답');
  });
  it('evaluates all ten candidates and preserves ranking/exclusions when requesting summaries',async()=>{
    const {recommendWithRouting:recommend,recommendation}=await import('../src/recommendations');
    for(const extra of [{availableMinutes:1440},{availableMinutes:1},{availableMinutes:1440,courseWeather:{yangpyeong:{condition:'sunny',temperatureC:22,windMps:2,source:'test',severe:true}}}]){
      const results=[];
      for(const free of [false,true]){
        const urls:string[]=[];
        external(url=>{urls.push(url);const u=new URL(url);expect(u.searchParams.get('generate_hints')).toBe('false');expect(u.searchParams.get('overview')).toBe('false');expect(u.searchParams.get('steps')).toBe(String(!free));const coords=u.pathname.split('/').at(-1)!.split(';').map(s=>s.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map((b,i)=>({distance:1000+urls.length*100,duration:60+urls.length*10,...(free?{}:{steps:[{geometry:{coordinates:[coords[i],b]}}]})}))}]});});
        const r=await recommend(recommendation.parse({...base,...extra}),config({ROAD_ROUTING_URL:'https://roads.test',FREE_PLAN_MODE:String(free)}));
        expect(urls).toHaveLength(r.weatherExcluded?9:10);
        const courses=[];
        for(const c of r.courses){const ticket=await resolve(c.navigationTicket,config().NAVIGATION_TICKET_SECRET);courses.push({id:c.id,km:c.estimatedRoundTripKm,minutes:c.estimatedMinutes,reasons:c.reasons,battery:c.batteryStatus,points:ticket.route.points});}
        results.push({courses,weatherExcluded:r.weatherExcluded,timeExcluded:r.timeExcluded,routingFailed:r.routingFailed,guidance:r.guidance});
      }
      expect(results[0]).toEqual(results[1]);
    }
  });
  it('returns controlled 429 when local quota is exceeded',async()=>{await quota(config(),'quota-test',1);await expect(quota(config(),'quota-test',1)).rejects.toMatchObject({code:'RATE_LIMIT',status:429});});
  it('keeps 405/415 status categories and never reflects a stack trace',async()=>{const wrongMethod=await call('/api/recommendations');expect(wrongMethod.status).toBe(405);expect(wrongMethod.headers.get('Allow')).toBe('POST');const r=await call('/api/recommendations',base,{headers:{'Content-Type':'text/plain'}});expect(r.status).toBe(415);expect(await r.json()).toEqual({error:'UNSUPPORTED_MEDIA_TYPE'});});
  it('enforces the explicit free-plan payload budget without changing the default contract',async()=>{
    const e=config({FREE_PLAN_MODE:'true'});
    expect((await call('/api/recommendations',{...base,padding:'x'.repeat(131072)},{env:e})).status).toBe(413);
    const geometry=Array.from({length:2001},()=>({latitude:37.56,longitude:127}));
    const r=await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry},{env:e});expect(r.status).toBe(413);expect(await r.json()).toEqual({error:'GEOMETRY_LIMIT_EXCEEDED'});
    expect((await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry:geometry.slice(0,2000)},{env:e})).status).toBe(200);
    expect((await call('/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry})).status).toBe(200);
  });
  it('rejects an altered signed payload and an expired ticket',async()=>{
    const {issue}=await import('../src/tickets'),{from64,url64,bytes,hmacKey,now}=await import('../src/utils');
    const r=await route('yangpyeong',37.5665,126.978,37.5665,126.978,15,config()),ticket=await issue('yangpyeong',r,config().NAVIGATION_TICKET_SECRET),[p,s]=ticket.split('.');
    const raw=JSON.parse(new TextDecoder().decode(from64(p)));raw.courseId='tampered';await expect(resolve(`${url64(bytes(JSON.stringify(raw)))}.${s}`,config().NAVIGATION_TICKET_SECRET)).rejects.toMatchObject({code:'INVALID_TICKET'});
    raw.expiresAt=now()-1;const payload=bytes(JSON.stringify(raw)),signature=await crypto.subtle.sign('HMAC',await hmacKey(config().NAVIGATION_TICKET_SECRET),payload);
    await expect(resolve(`${url64(payload)}.${url64(signature)}`,config().NAVIGATION_TICKET_SECRET)).rejects.toMatchObject({code:'INVALID_TICKET'});
  });
});
