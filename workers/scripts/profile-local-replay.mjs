// Local workerd CPU samples, NOT Cloudflare production CPU measurements.
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),WebSocket=createRequire(require.resolve('wrangler/package.json'))('ws');
const [target]=await (await fetch('http://127.0.0.1:9231/json')).json();
const ws=new WebSocket(target.webSocketDebuggerUrl,{origin:'http://localhost:9231'}),pending=new Map();let id=0;
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
ws.onmessage=e=>{const item=JSON.parse(e.data),p=pending.get(item.id);if(p){pending.delete(item.id);item.error?p.reject(item.error):p.resolve(item.result);}};
function command(method,params={}){return new Promise((resolve,reject)=>{const number=++id;pending.set(number,{resolve,reject});ws.send(JSON.stringify({id:number,method,params}));});}
const summaries=[];
try{
 await command('Profiler.enable');await command('Profiler.setSamplingInterval',{interval:100});
 for(const mode of ['validate','parse','read','compute','summary','full','d1']){
  const url='http://127.0.0.1:8791/'+mode;
  const warm=await fetch(url);await warm.arrayBuffer();
  await command('Profiler.start');const start=performance.now(),r=await fetch(url),data=await r.json(),wallMs=performance.now()-start;
  const {profile}=await command('Profiler.stop');await writeFile('.wrangler/profiling/local-'+mode+'.cpuprofile',JSON.stringify(profile));
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),totals=new Map();
  (profile.samples??[]).forEach((id,i)=>{const f=nodes.get(id).callFrame,key=f.functionName+' @ '+f.url+':'+(f.lineNumber+1);totals.set(key,(totals.get(key)??0)+(profile.timeDeltas[i]??0));});
  const rows=[...totals].map(([frame,micros])=>({frame,sampledMs:micros/1000})).sort((a,b)=>b.sampledMs-a.sampledMs);
  summaries.push({mode,notice:'LOCAL_WORKERD_REPLAY; not production attribution; includes sampling overhead',iterations:data.count,status:r.status,wallMs:Math.round(wallMs),activeSampledMs:rows.filter(x=>!/^\((idle|program|root)\)/.test(x.frame)).reduce((n,x)=>n+x.sampledMs,0),top:rows.slice(0,20)});
 }
}finally{ws.close();}
await writeFile('.wrangler/profiling/local-summary.json',JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries,null,2));
