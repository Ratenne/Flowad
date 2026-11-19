// Isolated Workers + national OSM + local OSRM integration. No production hosts.
import assert from 'node:assert/strict';
import {nationalOrigins} from './national-origins.mjs';
const origin=new URL(process.argv[2]??'http://127.0.0.1:8787');
if(origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('Integration runner accepts loopback only');
const results=[];
for(const [city,latitude,longitude] of nationalOrigins){
 const start=performance.now();
 const response=await fetch(new URL('/api/recommendations',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),originSource:'manual',latitude,longitude,availableMinutes:180,scenery:'all',vehicleType:'ice',walking:false,weather:{condition:'sunny',temperatureC:22,windMps:2,source:'ISOLATED_TEST'}}),signal:AbortSignal.timeout(60000)});
 const data=await response.json();assert.equal(response.status,200,JSON.stringify({city,error:data}));assert.ok(data.courses.length>0,JSON.stringify({city,data}));
 for(const course of data.courses){
  assert.match(course.id,/^dyn-/);assert.equal(course.route.status,'ESTIMATED_NOT_ROAD_ROUTED');assert.equal(course.vehicleTransferAllowed,false);assert.ok(course.estimatedMinutes<=180);
  assert.equal(course.route.totalSeconds,course.route.drivingSeconds+course.route.stopSeconds);
  assert.ok(course.route.legs.every(l=>l.geometry===null));
 }
 const ticket=data.courses[0].navigationTicket;
 const resolved=await fetch(new URL('/api/navigation/resolve',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});
 assert.equal(resolved.status,200);assert.deepEqual((await resolved.json()).route.points,data.courses[0].route.points);
 assert.equal(data.diagnostics.tableCalls,0);assert.equal(data.diagnostics.routeCalls,0);
 const verified=await fetch(new URL('/api/navigation/verify',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,vehicleType:'ice',availableMinutes:180})});
 const selected=await verified.json();
 if(verified.status===200){assert.equal(selected.roadVerified,true);assert.equal(selected.route.status,'ROAD_ROUTED');assert.ok(selected.route.legs.every(l=>l.geometry?.length>=2&&l.geometry.every(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude))));}
 else{assert.equal(selected.roadVerified,false);assert.ok(['WAYPOINT_TOO_FAR_FROM_ROAD','NO_ROAD_ROUTE'].includes(selected.error),JSON.stringify(selected));}
 const result={city,httpStatus:response.status,courses:data.courses.length,selectedRoadVerified:selected.roadVerified,selectedError:selected.error,geometryPoints:selected.roadVerified?selected.route.legs.reduce((sum,l)=>sum+l.geometry.length,0):0,elapsedMs:Math.round(performance.now()-start),diagnostics:data.diagnostics};
 results.push(result);console.log(JSON.stringify({event:'national_region_verified',...result}));
}
console.log('NATIONAL_VALIDATION_JSON='+JSON.stringify({mode:'ISOLATED_WORKER_D1_REAL_NATIONAL_OSRM',results}));
