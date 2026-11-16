import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {cf,accountId} from './cloudflare-client.mjs';
const roadConfigured=(await cf(`/accounts/${accountId}/workers/scripts/flowad-api-stage2/settings`)).result.bindings.some(b=>b.name==='ROAD_ROUTING_URL'&&b.text);
const origin='https://flowad-api-stage2.o94777.workers.dev',records=[],results=[];
let firstKeys;
function tail(name,unlabelled=false){
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail',name,'--config','wrangler.stage2.jsonc','--format','json'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let buffer='',depth=0,start=-1,string=false,escape=false;
child.stdout.on('data',chunk=>{
  const raw=chunk.toString();
  for(const ch of raw){buffer+=ch;
    if(start<0){if(ch==='{'){start=buffer.length-1;depth=1;}else if(buffer.length>10000)buffer='';continue;}
    if(string){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')string=false;continue;}
    if(ch==='"'){string=true;continue;}if(ch==='{')depth++;if(ch==='}')depth--;
    if(depth===0){try{
      const item=JSON.parse(buffer.slice(start));firstKeys??=Object.keys(item);
      const req=item.event?.request,label=req?.headers?.['x-flowad-test-id'];
      if(label||unlabelled)records.push({label:label??'road-rpc',worker:name,outcome:item.outcome,cpuTimeMs:item.cpuTime??item.cpuTimeMs??null,wallTimeMs:item.wallTime??item.wallTimeMs??null,status:item.event?.response?.status??null});
    }catch{/* No raw logs or headers are printed. */}buffer='';start=-1;}
  }
});
// Wrangler may emit non-JSON connection diagnostics. Retain no raw output.
child.stderr.on('data',()=>{});
return child;
}
const children=[tail('flowad-api-stage2')];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const base={latitude:37.5665,longitude:126.978,availableMinutes:180,scenery:'forest',vehicleType:'ev'};
async function request(label,path,body,extra={}){
  const start=performance.now(),r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Flowad-Test-Id':label,...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{/* HTML/error checks below. */}
  results.push({label,path,serverDate:r.headers.get('date'),finalPath:new URL(r.url).pathname,status:r.status,wallRoundTripMs:Math.round((performance.now()-start)*10)/10,cloudflareRay:!!r.headers.get('cf-ray'),responseKind:data?'JSON':r.headers.get('content-type'),jsonKeys:data&&!Array.isArray(data)?Object.keys(data):undefined,courses:data?.courses?.length,routeStatus:data?.courses?.[0]?.distanceTimeStatus,chargingStatus:data?.status,cloudflareError:text.match(/(?:error code:|Error)\s*(1102|1027)/i)?.[1]??null});
  return{r,data};
}
try{
  await pause(6000);
  await request('frontend','/flowad/');await request('script','/flowad/app.js');await request('check-page','/flowad/tesla-check.html');
  const normal=await request('recommendation','/flowad/api/recommendations',base);assert.equal(normal.r.status,200);
  await request('ticket','/flowad/api/navigation/resolve',{ticket:normal.data.courses[0].navigationTicket});
  await request('charging-required','/flowad/api/charging/recommendations',{});
  const status=await request('tesla-status','/flowad/api/tesla/status');assert.equal(status.r.status,200);
  const cookie=status.r.headers.get('set-cookie').split(';')[0];
  await request('tesla-session','/flowad/api/tesla/status',undefined,{Cookie:cookie});
  await request('tesla-unconfigured','/flowad/api/tesla/authorize',{}, {Cookie:cookie,'X-CSRF-Token':status.data.csrf});
  await request('return','/flowad/api/recommendations',{...base,availableMinutes:1440,returnLatitude:35.1796,returnLongitude:129.0756});
  await request('weather','/flowad/api/recommendations',{...base,availableMinutes:1440,weather:{condition:'sunny',temperatureC:30,windMps:9,source:'public benchmark',observedAt:null}});
  for(let i=0;i<(roadConfigured?2:15);i++)await request('repeat-'+i,'/flowad/api/recommendations',{...base,scenery:['all','forest','coast','open'][i%4]});
  for(const n of [2,500,2000,5000,20000])await request('geometry-'+n,'/flowad/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry:Array.from({length:n},(_,i)=>({latitude:37.65+i/1000000,longitude:127+i/1000000}))});
  await request('invalid','/flowad/api/recommendations',{});
  await request('wrong-method','/flowad/api/recommendations');
  await request('cors-denied','/flowad/api/recommendations',base,{Origin:'https://untrusted.example'});
  await pause(5000);
}finally{
  children.forEach(child=>child.kill());
  const cpu=records.map(r=>r.cpuTimeMs).filter(n=>typeof n==='number'),out={observedAt:new Date().toISOString(),origin,results,traceKeys:firstKeys,metrics:records,cpuSummary:cpu.length?{samples:cpu.length,maxMs:Math.max(...cpu),medianMs:cpu.sort((a,b)=>a-b)[Math.floor(cpu.length/2)]}:null,memoryStatus:'No per-request heap measurement; inspect invocation outcomes for limit errors.'};
  await writeFile('.wrangler/stage2/http-metrics.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
