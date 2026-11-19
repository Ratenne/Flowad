// Public-place smoke checks only. Never reads a vehicle/session or sends commands.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {apiBase,productionArguments} from './production-target.mjs';
const args=process.argv.slice(2),qa=args.includes('--test-worker');
if(!qa)productionArguments(args);
const root=qa?'https://flowad-navigation-qa.o94777.workers.dev/flowad':apiBase;
const results=[];
async function post(path,body){
 const start=Date.now(),r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
 return {status:r.status,data:await r.json(),elapsedMs:Date.now()-start};
}
const ready=await post('/api/navigation/readiness',{});
assert.equal(ready.status,200);assert.equal(ready.data.ready,true);
const pois=gunzipSync(readFileSync(new URL('../../dist/data/pois-osm.ndjson.gz',import.meta.url))).toString().trim().split('\n').map(s=>JSON.parse(s));
const publicStops=['송정해수욕장','일광해수욕장'].map(name=>{
 const poi=pois.find(p=>p.name===name&&p.category==='beach'&&p.region==='부산광역시');assert(poi);return poi.id;
});
const input={latitude:35.1796,longitude:129.0756,availableMinutes:180,scenery:'coast',vehicleType:'ice',walking:false};
for(const [label,extra] of [['automatic',{}],['public-songjeong-ilgwang',{poiIds:publicStops}],['oneway',{roundTrip:false}]]){
 const rec=await post('/api/recommendations',{...input,...extra});assert.equal(rec.status,200);assert(rec.data.courses.length);
 let success=false;
 for(const course of rec.data.courses.slice(0,3)){
  const points=course.route.points;
  assert(points.some(p=>p.type==='SCENIC_WAYPOINT'));assert.equal(points.filter(p=>p.type==='DESTINATION').length,1);
  assert.equal(points.at(-1).type,extra.roundTrip===false?'DESTINATION':'RETURN');
  assert(course.route.legs.every(l=>l.geometry===null));assert.equal(course.vehicleTransferAllowed,false);
  if(extra.poiIds)assert.deepEqual(course.waypoints.map(p=>p.id),extra.poiIds);
  const verified=await Promise.all([post('/api/navigation/verify',{ticket:course.navigationTicket,...input}),post('/api/navigation/verify',{ticket:course.navigationTicket,...input})]);
  if(verified.some(v=>v.status!==200)){
   results.push({label,course:course.name,errors:verified.map(v=>({http:v.status,error:v.data.error,waypointOrders:v.data.waypointOrders}))});continue;
  }
  for(const v of verified){assert.equal(v.data.roadVerified,true);assert.equal(v.data.route.status,'ROAD_ROUTED');assert.deepEqual(v.data.route.points,points);
   const resolved=await post('/api/navigation/resolve',{ticket:v.data.navigationTicket});assert.equal(resolved.status,200);assert.deepEqual(resolved.data.route.points,points);
  }
  results.push({label,course:course.name,recommendationHttp:rec.status,courseCount:rec.data.courses.length,verificationHttp:200,resolveHttp:200,pointTypes:points.map(p=>p.type),samePoints:true,verifyMs:verified.map(v=>v.elapsedMs)});
  success=true;break;
 }
 assert(success,label+' has no verified course');
}
for(const [body,error] of [[{ticket:'invalid.signature'},'INVALID_TICKET'],[{ticket:'invalid.signature',availableMinutes:0},'INVALID_REQUEST']]){
 const r=await post('/api/navigation/verify',body);assert.equal(r.status,400);assert.equal(r.data.error,error);results.push({label:error,http:r.status});
}
const report={checkedAt:new Date().toISOString(),target:root,readinessHttp:ready.status,results,commandsSent:0,coldStartControlled:false,realVehicleVerified:false};
const output=args.find(a=>a.startsWith('--output='))?.slice(9);if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
