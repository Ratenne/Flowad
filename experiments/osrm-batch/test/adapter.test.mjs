import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate,execute} from '../adapter.mjs';
import {server} from '../server.mjs';
const routes=Array.from({length:10},(_,i)=>({id:'course-'+i,coordinates:[[126.978,37.5665],[127,37.6]]}));
const base='https://osrm.example';
test('validates a bounded batch with unique IDs and valid coordinates',()=>{
 assert.equal(validate({version:1,routes}).length,10);
 for(const bad of [{version:2,routes},{version:1,routes:[...routes,routes[0]]},{version:1,routes:[routes[0],routes[0]]},{version:1,routes:[{...routes[0],coordinates:[[181,0],[1,1]]}]}])assert.throws(()=>validate(bad));
});
test('runs all ten sequentially, strips unused fields, and continues after NoSegment',async()=>{
 let active=0,max=0,calls=0;
 const out=await execute(routes,{base,fetcher:async url=>{calls++;active++;max=Math.max(max,active);const u=new URL(url);assert.equal(u.searchParams.get('steps'),'false');assert.equal(u.searchParams.get('generate_hints'),'false');await new Promise(r=>setTimeout(r,1));active--;return calls===3?Response.json({code:'NoSegment',message:'ignored'},{status:400}):Response.json({code:'Ok',waypoints:[{location:[126.978,37.5665],distance:0,hint:'unused'}],routes:[{weight:1,legs:[{distance:42,duration:3,steps:[{geometry:{coordinates:[[1,2]]}}]}]}]});}});
 assert.equal(calls,10);assert.equal(max,1);assert.deepEqual(out.results.map(x=>x.id),routes.map(x=>x.id));assert.equal(out.results[2].data.code,'NoSegment');assert.deepEqual(out.results[0].data.routes,[{legs:[{distance:42,duration:3}]}]);assert.equal(out.results[0].data.waypoints[0].hint,undefined);
});
for(const status of [403,429,503])test('preserves global early stop for '+status,async()=>{
 let calls=0;const out=await execute(routes,{base,fetcher:async()=>{calls++;return Response.json({}, {status});}});assert.equal(calls,1);assert.equal(out.results[0].status,status);assert.equal(out.results.length,10);assert.equal(out.results[1].error,'PROVIDER_UNAVAILABLE');
});
test('network timeout/failure stops without retries',async()=>{
 let calls=0;const out=await execute(routes,{base,fetcher:async()=>{calls++;throw new DOMException('timeout','TimeoutError');}});assert.equal(calls,1);assert.equal(out.results[0].error,'PROVIDER_UNAVAILABLE');
});
test('HTTP authentication and body/method checks reject without OSRM calls',async()=>{
 const token='public-test-credential-'.repeat(3);let calls=0;
 const app=server({token,base,fetcher:async()=>{calls++;return Response.json({code:'NoSegment'},{status:400});}});await new Promise(r=>app.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.address().port+'/v1/routes/batch';
 try{
  assert.equal((await fetch(url,{method:'POST'})).status,403);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token}})).status,405);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:1,routes})})).status,200);assert.equal(calls,10);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'x'.repeat(16385)})).status,413);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})).status,400);assert.equal(calls,10);
 }finally{await new Promise(r=>app.close(r));}
});
