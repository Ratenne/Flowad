// Isolated Workers + national OSM + local OSRM integration. No production hosts.
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]??'http://127.0.0.1:8787');
if(origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('Integration runner accepts loopback only');
const results=[];
for(const [city,latitude,longitude] of [['서울',37.5665,126.978],['부산',35.1796,129.0756],['대구',35.8714,128.6014],['제주',33.4996,126.5312],['강원',37.74,128.75],['저밀도',34.9,126.4]]){
 const start=performance.now();
 const response=await fetch(new URL('/api/recommendations',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),originSource:'manual',latitude,longitude,availableMinutes:180,scenery:'all',vehicleType:'ice',walking:false,weather:{condition:'sunny',temperatureC:22,windMps:2,source:'ISOLATED_TEST'}}),signal:AbortSignal.timeout(60000)});
 const data=await response.json();assert.equal(response.status,200,JSON.stringify({city,error:data}));assert.ok(data.courses.length>0,JSON.stringify({city,data}));
 for(const course of data.courses){
  assert.match(course.id,/^dyn-/);assert.equal(course.route.status,'ROAD_ROUTED');assert.ok(course.estimatedMinutes<=180);
  assert.equal(course.route.totalSeconds,course.route.drivingSeconds+course.route.stopSeconds);
  assert.ok(course.route.legs.every(l=>l.geometry?.length>=2));
  assert.ok(course.route.legs.every(l=>l.geometry.every(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude))));
 }
 const ticket=data.courses[0].navigationTicket;
 const resolved=await fetch(new URL('/api/navigation/resolve',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
 assert.equal(resolved.status,200);assert.deepEqual((await resolved.json()).route.points,data.courses[0].route.points);
 if(city==='서울'){
  const verified=await fetch(new URL('/api/navigation/verify',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,vehicleType:'ice',availableMinutes:180})});
  assert.equal(verified.status,200);assert.equal((await verified.json()).roadVerified,true);
 }
 results.push({city,courses:data.courses.length,geometryPoints:data.courses.reduce((sum,c)=>sum+c.route.legs.reduce((s,l)=>s+l.geometry.length,0),0),elapsedMs:Math.round(performance.now()-start),diagnostics:data.diagnostics});
}
console.log('NATIONAL_VALIDATION_JSON='+JSON.stringify({mode:'ISOLATED_WORKER_D1_REAL_NATIONAL_OSRM',results}));
