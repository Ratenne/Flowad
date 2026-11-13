// Capture actual deployed-worker CPU samples. Public Seoul test input only.
import {mkdir,writeFile} from 'node:fs/promises';
import {cf,accountId} from './cloudflare-client.mjs';
const label=process.argv[2]??'baseline';if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid profile label');
const origin='https://flowad-api-stage2.o94777.workers.dev',results=[];
const body={latitude:37.5665,longitude:126.978,availableMinutes:180,scenery:'forest',vehicleType:'ev'};
await mkdir('.wrangler/profiling',{recursive:true});
const workers=(await cf(`/accounts/${accountId}/workers/workers`)).result;
const worker=workers.find(w=>w.name==='flowad-api-stage2');if(!worker)throw new Error('Target Worker not found');
const deployment=(await cf(`/accounts/${accountId}/workers/scripts/flowad-api-stage2/deployments`)).result.deployments[0];
const version=deployment.versions.find(v=>v.percentage===100)?.version_id;if(!version)throw new Error('Expected single active version');
async function hit(){const start=performance.now();try{const r=await fetch(origin+'/flowad/api/recommendations',{method:'POST',headers:{'Content-Type':'application/json','X-Flowad-Test-Id':'cpu-profile'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await r.json();results.push({status:r.status,serverDate:r.headers.get('Date'),wallMs:Math.round(performance.now()-start),courses:data.courses?.length,geometryStatus:data.courses?.[0]?.route?.geometryStatus});}catch(e){results.push({errorType:e.name});}}
await hit();let running=true;
async function traffic(){while(running)await hit();}
const loops=[traffic(),traffic()];let capture;
try{
  const r=await cf(`/accounts/${accountId}/workers/workers/${worker.id}/versions/${version}/profile`,{raw:true,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration_ms:10000,profile_type:'cpu'})});
  const raw=Buffer.from(await r.arrayBuffer());await writeFile(`.wrangler/profiling/${label}.pprof`,raw);capture={available:true,bytes:raw.length,contentType:r.headers.get('content-type')};
}catch(e){capture={available:false,error:e.message};}
finally{running=false;await Promise.all(loops);}
const out={label,workerId:worker.id,version,capture,requests:results};await writeFile(`.wrangler/profiling/${label}-requests.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
