// Local real-OSRM readiness + national graph coverage. No fallback or route retry.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {nationalOrigins} from './national-origins.mjs';
const base=new URL(process.argv[2]??'http://127.0.0.1:5000');
if(base.protocol!=='http:'||!['localhost','127.0.0.1'].includes(base.hostname))throw Error('OSRM check accepts loopback only');
async function probe(service,coordinates,city){
 const start=performance.now();let httpStatus=null,osrmCode=null;
 try{
  const options=service==='table'?'annotations=duration,distance':'overview=false';
  const response=await fetch(new URL(`/${service}/v1/driving/${coordinates.join(';')}?${options}&generate_hints=false&radiuses=${coordinates.map(()=>100).join(';')}`,base),{signal:AbortSignal.timeout(5000)});
  httpStatus=response.status;const data=await response.json();
  osrmCode=['Ok','NoSegment','NoTable','TooBig','InvalidQuery','InvalidOptions','InvalidValue','NotImplemented'].includes(data.code)?data.code:'UNKNOWN';
  assert.equal(httpStatus,200);assert.equal(osrmCode,'Ok');
  const count=coordinates.length;
  if(service==='table'){
   for(const name of ['durations','distances']){assert.equal(data[name]?.length,count);for(const row of data[name]){assert.equal(row.length,count);assert.ok(row.every(v=>Number.isFinite(v)&&v>=0));}}
   assert.equal(data.sources?.length,count);
   assert.ok(data.sources.every(p=>Number.isFinite(p.distance)&&p.distance<=100));
  }else{assert.ok(data.routes?.[0]?.legs?.length===count-1);assert.ok(data.routes[0].distance>0);assert.ok(data.routes[0].duration>0);}
  console.log(JSON.stringify({event:'osrm_probe_ok',service,city,httpStatus,osrmCode,coordinateCount:count,elapsedMs:Math.round(performance.now()-start)}));
 }catch(error){
  const reason=httpStatus===null?(error.name==='TimeoutError'?'timeout':'connection_failure'):osrmCode===null?'invalid_json':osrmCode==='Ok'?'invalid_response':'osrm_error';
  console.error(JSON.stringify({event:'osrm_probe_failure',service,city,httpStatus,osrmCode,coordinateCount:coordinates.length,elapsedMs:Math.round(performance.now()-start),reason}));
  // Only process startup (no HTTP response) may be polled. Bad requests/data fail immediately.
  throw Object.assign(new Error(`OSRM ${service} check failed: ${reason}`),{starting:httpStatus===null});
 }
}
const seoul=['126.978,37.5665','126.979,37.5665'];
// Exercise both annotations and the actual maximum candidate workload (20+2),
// rather than accepting a live Nearest endpoint as Table readiness.
const deadline=Date.now()+120000;
for(;;){
 try{await probe('table',Array.from({length:22},(_,i)=>seoul[i%2]),'readiness');break;}
 catch(error){if(!error.starting||Date.now()>=deadline)throw error;await delay(Math.min(1000,Math.max(0,deadline-Date.now())));}
}
for(const [city,latitude,longitude] of nationalOrigins){
 const coordinates=[`${longitude},${latitude}`,`${longitude+.0001},${latitude}`];
 await probe('route',coordinates,city);await probe('table',coordinates,city);
}
