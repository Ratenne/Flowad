// Functional smoke only. Public Seoul coordinates; no Tesla login or commands.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import catalog from '../../backend/src/main/resources/courses.json' with {type:'json'};
const root=process.env.FLOWAD_TEST_ORIGIN??'https://flowad-api-stage2.o94777.workers.dev',prefix='/flowad',results=[];
const base={latitude:37.5665,longitude:126.978,availableMinutes:1440,scenery:'forest',vehicleType:'ev',batteryPercent:70,estimatedRangeKm:400};
async function request(label,path,body){
 const t=performance.now(),r=await fetch(root+prefix+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)}),text=await r.text();let data;try{data=JSON.parse(text);}catch{}
 results.push({label,path,status:r.status,serverDate:r.headers.get('date'),wallMs:Math.round(performance.now()-t),keys:data?Object.keys(data):[],verificationStatus:data?.verificationStatus,roadVerified:data?.roadVerified,error:data?.error,routeStatus:data?.route?.status,courseCount:data?.courses?.length,weatherExcluded:data?.weatherExcluded,routingFailed:data?.routingFailed});return {r,data};
}
const normal=await request('base-estimate','/api/recommendations',base);assert.equal(normal.r.status,200);assert.equal(normal.data.courses.length,3);assert.ok(normal.data.courses.every(c=>c.route.status==='ESTIMATED_NOT_ROAD_ROUTED'));
const resolved=await request('existing-ticket','/api/navigation/resolve',{ticket:normal.data.courses[0].navigationTicket});assert.equal(resolved.r.status,200);assert.equal(resolved.data.route.status,'ESTIMATED_NOT_ROAD_ROUTED');
assert.equal((await request('invalid','/api/recommendations',{})).r.status,400);
const severe=await request('ten-weather-exclusions','/api/recommendations',{...base,originSevere:true});assert.equal(severe.data.weatherExcluded,10);
const forged=await request('forged-verification','/api/navigation/verify',{ticket:'forged.signature'});assert.equal(forged.data.roadVerified,false);
const one=id=>({...base,courseWeather:Object.fromEntries(catalog.map(c=>[c.id,{condition:'sunny',temperatureC:22,windMps:2,source:'public functional fixture',severe:c.id!==id}]))});
for(const id of ['yangpyeong','paju']){
 const candidate=await request(id+'-estimate','/api/recommendations',one(id));assert.equal(candidate.data.courses[0].id,id);assert.equal(candidate.data.weatherExcluded,9);
 const verification=await request(id+'-road','/api/navigation/verify',{ticket:candidate.data.courses[0].navigationTicket,vehicleType:'ev',batteryPercent:70,estimatedRangeKm:400,availableMinutes:1440});
 if(verification.data.roadVerified){assert.equal(id,'yangpyeong');assert.equal(verification.data.route.status,'ROAD_ROUTED');const v=await request('verified-ticket','/api/navigation/resolve',{ticket:verification.data.navigationTicket});assert.equal(v.data.route.status,'ROAD_ROUTED');}
 else if(id==='paju'&&!['PROVIDER_UNAVAILABLE','RATE_LIMIT','PROVIDER_PERMISSION_DENIED'].includes(verification.data.error))assert.equal(verification.data.error,'WAYPOINT_TOO_FAR_FROM_ROAD');
}
const after=await request('base-after-road-request','/api/recommendations',base);assert.equal(after.r.status,200);assert.ok(after.data.courses.every(c=>c.route.status==='ESTIMATED_NOT_ROAD_ROUTED'));
const session=await request('fresh-browser-d1-session','/api/tesla/status');assert.equal(session.r.status,200);assert.equal(session.data.secure,true);
const home=await request('frontend','/');assert.equal(home.r.status,200);
const out={origin:root,results,roadPositivePassed:results.some(r=>r.label==='yangpyeong-road'&&r.roadVerified===true),noSegmentPassed:results.some(r=>r.label==='paju-road'&&r.error==='WAYPOINT_TOO_FAR_FROM_ROAD'),tesla:'Fresh anonymous session/D1 only; real OAuth/Fleet not tested by this script',commandsSent:0};
await writeFile('evidence/final-functional.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
