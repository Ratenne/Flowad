import assert from 'node:assert/strict';
const origin='http://127.0.0.1:18787';
const body={latitude:37.5665,longitude:126.978,availableMinutes:180,scenery:'forest',vehicleType:'ev'};
async function post(path,body){return fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
const start=performance.now(),r=await post('/api/recommendations',body),data=await r.json();
assert.equal(r.status,200);assert.equal(data.courses.length,3);assert.equal(data.courses[0].distanceTimeStatus,'ESTIMATED_NOT_ROAD_ROUTED');
const ticket=await post('/api/navigation/resolve',{ticket:data.courses[0].navigationTicket});assert.equal(ticket.status,200);assert.equal((await ticket.json()).courseId,data.courses[0].id);
assert.equal((await post('/api/recommendations',{})).status,400);
assert.equal((await fetch(origin+'/api/tesla/status').then(r=>r.json())).secure,false);
assert.equal((await post('/api/tesla/vehicles',{})).status,403);
assert.equal((await post('/api/location/address',{latitude:37,longitude:127})).status,503);
assert.equal((await fetch(origin+'/api/recommendations')).status,405);
const timings=[];for(let i=0;i<10;i++){const t=performance.now();const r=await post('/api/recommendations',body);assert.equal(r.status,200);await r.arrayBuffer();timings.push(performance.now()-t);}
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({status:'LOCAL_TEST_PASSED',checks:17,roundTripWallMs:{median:Math.round(timings[5]*10)/10,max:Math.round(timings.at(-1)*10)/10},elapsedWallMs:Math.round(performance.now()-start),cpuLimitStatus:'NOT_VERIFIED',note:'HTTP wall time includes local proxy, D1 and I/O; it is not Workers CPU time.'},null,2));
