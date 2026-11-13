// Measurements describe the separate Node adapter. Remote OSRM CPU/RAM is not exposed.
import {readFile,writeFile} from 'node:fs/promises';
import anchors from '../../backend/src/main/resources/anchors.json' with {type:'json'};
import catalog from '../../backend/src/main/resources/courses.json' with {type:'json'};
const token=(await readFile('.wrangler/profiling/batch-token','utf8')).trim();
const routes=catalog.map(c=>({id:c.id,coordinates:[[126.978,37.5665],...anchors[c.id].anchors.map(a=>a.coordinate),[126.978,37.5665]]}));
const results=[];
for(let i=0;i<5;i++){
 const start=performance.now();
 try{const r=await fetch('https://flowad-batch-experiment.onrender.com/v1/routes/batch',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:1,routes}),signal:AbortSignal.timeout(90000)}),text=await r.text();let data;try{data=JSON.parse(text);}catch{}
 results.push({serverDate:r.headers.get('date'),status:r.status,clientWallMs:Math.round(performance.now()-start),bytes:Buffer.byteLength(text),providerStates:data?.results?.map(v=>({id:v.id,status:v.status,code:v.data?.code,error:v.error})),metrics:data?.metrics});
 }catch(e){results.push({error:e.name,clientWallMs:Math.round(performance.now()-start)});}
}
await writeFile('evidence/batch-adapter-metrics.json',JSON.stringify({warning:'Separate adapter process/container only, not OSRM CPU/RAM; no forced production restarts',results},null,2));console.log(JSON.stringify(results,null,2));
