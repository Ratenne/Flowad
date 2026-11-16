// Actual Cloudflare invocation CPU; public fixtures, no Tesla/session requests.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {cf,accountId} from './cloudflare-client.mjs';
import {createHash} from 'node:crypto';
const label=process.argv[2]??'baseline';if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid label');
const rounds=Number(process.argv[3]??12);if(!Number.isInteger(rounds)||rounds<1||rounds>40)throw new Error('Use 1..40 requests');
const deployment=(await cf(`/accounts/${accountId}/workers/scripts/flowad-api-stage2/deployments`)).result.deployments[0];
const version=deployment.versions.find(v=>v.percentage===100)?.version_id;
if(!version)throw new Error('Expected a single active deployment');
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail','flowad-api-stage2','--config','wrangler.stage2.jsonc','--format','json'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let buffer='',depth=0,quoted=false,escaped=false;const traces=[],requests=[];
child.stderr.on('data',()=>{});
child.stdout.on('data',chunk=>{for(const c of chunk.toString()){
 if(!depth){if(c!=='{')continue;buffer='';depth=1;}else if(!quoted){if(c==='{')depth++;if(c==='}')depth--;}
 buffer+=c;if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;
 if(!depth){try{const x=JSON.parse(buffer),id=x.event?.request?.headers?.['x-flowad-test-id'];if(id?.startsWith(label+'-'))traces.push({id,cpuMs:x.cpuTime,wallMs:x.wallTime,outcome:x.outcome,status:x.event?.response?.status});}catch{}buffer='';}
}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{await sleep(6000);
 for(let i=0;i<rounds;i++){
  const id=label+'-'+i,start=performance.now();
  const body={latitude:37.5665,longitude:126.978,availableMinutes:i%3===0?1440:180,scenery:['all','forest','coast','open'][i%4],vehicleType:'ev',...(i%3===2?{walking:false}:{} )};
  try{
   const r=await fetch('https://flowad-api-stage2.o94777.workers.dev/flowad/api/recommendations',{method:'POST',headers:{'Content-Type':'application/json','X-Flowad-Test-Id':id},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)}),text=await r.text(),data=JSON.parse(text);
   const stable=JSON.stringify(data,(k,v)=>['navigationTicket','generatedAt'].includes(k)?undefined:v);
   requests.push({id,case:i%12,serverDate:r.headers.get('date'),colo:r.headers.get('cf-ray')?.split('-').at(-1),status:r.status,roundTripWallMs:Math.round(performance.now()-start),decodedResponseBytes:Buffer.byteLength(text),contractHash:createHash('sha256').update(stable).digest('hex'),courses:data.courses?.map(c=>c.id),weatherExcluded:data.weatherExcluded,timeExcluded:data.timeExcluded,routingFailed:data.routingFailed,geometryStatus:data.courses?.[0]?.route?.geometryStatus});
  }catch(e){requests.push({id,error:e.name,roundTripWallMs:Math.round(performance.now()-start)});}
 }
 await sleep(5000);
}finally{child.kill();}
const values=traces.map(x=>x.cpuMs).filter(x=>typeof x==='number').sort((a,b)=>a-b);
const end=(await cf(`/accounts/${accountId}/workers/scripts/flowad-api-stage2/deployments`)).result.deployments[0].versions.find(v=>v.percentage===100)?.version_id;
const out={label,version,endVersion:end,fixedDeployment:version===end,requests,traces,cpu:values.length?{n:values.length,min:values[0],median:values[Math.floor(values.length/2)],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1),over10:values.filter(x=>x>10).length}:null};
await writeFile('.wrangler/profiling/cloudflare-'+label+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
