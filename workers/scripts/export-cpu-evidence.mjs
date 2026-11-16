import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const load=async name=>JSON.parse(await readFile('.wrangler/profiling/'+name,'utf8'));
const before=await load('cloudflare-before.json'),after=await load('cloudflare-after.json');
const contract=r=>({status:r.status,courses:r.courses,weatherExcluded:r.weatherExcluded,timeExcluded:r.timeExcluded,routingFailed:r.routingFailed,geometryStatus:r.geometryStatus});
assert.equal(before.requests.length,12);assert.equal(after.requests.length,12);
before.requests.forEach((r,i)=>assert.deepEqual(contract(r),contract(after.requests[i])));
const sizes=await load('osrm-sizes.json'),local=await load('local-summary.json');
const out={
 status:'FAILED',productionCutover:'BLOCKED',candidatePolicy:'Original 10 candidates; existing weather filters/global provider-failure early exit unchanged',
 before,after,
 liveComparison:{matchedResponses:12,compared:['HTTP status','ordered course IDs','weatherExcluded','timeExcluded','routingFailed','geometryStatus']},
 osrmPublicFixture:sizes,
 productionFunctionProfile:{status:'NOT_VERIFIED',error:'Official profile endpoint returned HTTP404, code10394; active version UUID and immutable worker ID also attempted'},
 localReplay:{status:'LOCAL_TEST_PASSED',warning:'Local workerd sampling only, not production phase attribution. 100us requested interval; Windows effective sample intervals vary. Warm batches; includes profiler/native/GC overhead. Full replay20 iterations, other batches100. D1 is local Miniflare, not remote database.',phases:local},
 conclusion:'Small-body optimizations help observed median, but cannot claim robust <=10ms. Production route remains flowad-path-proxy. No real Tesla calls/commands in this investigation.'
};
await writeFile('evidence/cpu-investigation.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({before:before.cpu,after:after.cpu,matchedResponses:12,productionCutover:'BLOCKED'}));
