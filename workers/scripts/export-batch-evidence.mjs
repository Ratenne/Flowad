import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const load=async path=>JSON.parse(await readFile(path,'utf8'));
const direct=await load('.wrangler/profiling/cloudflare-batch-baseline-fixed.json'),batch=await load('.wrangler/profiling/cloudflare-batch-adapted-fixed.json');
assert.equal(direct.fixedDeployment,true);assert.equal(batch.fixedDeployment,true);
assert.equal(direct.requests.length,24);assert.equal(batch.requests.length,36);
for(const set of [direct,batch]){
 assert.equal(set.traces.length,set.requests.length);
 for(const r of set.requests){assert.equal(r.status,200);assert.equal(r.routingFailed,4);assert.ok(r.courses.length>0);}
}
const reference=new Map();for(const r of direct.requests){if(reference.has(r.case))assert.equal(r.contractHash,reference.get(r.case));reference.set(r.case,r.contractHash);}
for(const r of batch.requests)assert.equal(r.contractHash,reference.get(r.case));
const stats=values=>{const a=values.slice().sort((a,b)=>a-b);return {min:a[0],median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
const summary=x=>({requests:x.requests.length,cpuMs:x.cpu,workerWallMs:stats(x.traces.map(t=>t.wallMs)),clientWallMs:stats(x.requests.map(r=>r.roundTripWallMs)),clientDecodedBytes:stats(x.requests.map(r=>r.decodedResponseBytes)),httpErrorCount:x.requests.filter(r=>r.status!==200).length,emptyRecommendations:x.requests.filter(r=>!r.courses?.length).length,platformNonOk:x.traces.filter(t=>t.outcome!=='ok').length,colos:[...new Set(x.requests.map(r=>r.colo))]});
const adapter=await load('evidence/batch-adapter-metrics.json'),initial=await load('.wrangler/profiling/cloudflare-batch-direct.json');
const tests=await load('.wrangler/profiling/batch-tests.json');assert.equal(tests.success,true);
const out={status:'FAILED_CPU_STABILITY',productionTransition:'BLOCKED',architecture:'Separate experimental Render Node adapter -> unchanged Render OSRM. Not co-located; does not remove Render.',comparison:{direct:summary(direct),batch:summary(batch),contractHashesMatched:36,distinctInputCases:12,ignoredDynamicFields:['generatedAt','navigationTicket'],batchPostFirstCpuMs:stats(batch.traces.slice(1).map(t=>t.cpuMs)),fixedDeployment:true},direct,batch,adapter,
 initialProviderUnavailable:{note:'Not a normal recommendation benchmark; 24 HTTP200 empty responses, existing global failure early-exit. Exact upstream HTTP codes were not exposed by API.',...initial},
 discardedRun:{label:'batch-direct-warm',reason:'Configuration changed during measurement and initial adapter probes overlapped; excluded from paired statistics.'},
 osrm:{unchangedCommit:'858c4ef8c90dbc531bf28b45f40d40f337a4a82e',branch:'codex/korea-roads-free',serviceId:'srv-dbieeqec6qcc73a9dm70',declaredCpu:0.15,declaredRamMiB:512,actualCpuAndRam:'NOT_VERIFIED: free application metrics/SSH unavailable',observedStartupLog:'2026-11-12 20:11:24 Asia/Seoul',startupLoggedMemoryLimitBytes:536870912,nearestEventuallyVerifiedHttp200:'2026-11-12 11:15:13 GMT',coldStart:'Restart observed after unavailable requests; exact spin-up duration not measured continuously; no forced restart'},
 experiment:{serviceId:'srv-dbqprjjm8hqs73ei1e10',url:'https://flowad-batch-experiment.onrender.com',declaredCpu:0.1,declaredRamMiB:512,branch:'codex/osrm-batch-experiment',commit:'5a9d72356a7fd1b04f4b04b921e7f318fd5d9334',runtime:'Node22.23.5',credential:'Isolated key rotated after UI output exposure; final rotated-key authentication succeeded. No key material retained here.'},
 tests:{workers:{passed:tests.numPassedTests,failed:tests.numFailedTests},nodeAdapter:{passed:7,failed:0},typecheck:'PASSED',lint:'PASSED',build:'PASSED: actual stage2 deployments'},
 limitations:['One Cloudflare colo LAX, sequential requests; not a load/SLA proof','First batch invocation23ms; warm35 invocations all<=10ms does not prove cold stability','Original OSRM CPU/RAM cannot be inferred from separate adapter process metrics','No real TLS/DNS/service timeout stress test or forced production restart','No real Tesla calls, navigation commands, Android or Pleos development']};
await writeFile('evidence/batch-comparison.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out.comparison,null,2));
