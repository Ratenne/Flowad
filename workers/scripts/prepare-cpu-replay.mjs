// Public Seoul fixture only. No user location, Tesla credentials or D1 data.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const anchors=JSON.parse(await readFile('../backend/src/main/resources/anchors.json','utf8'));
await mkdir('.wrangler/profiling',{recursive:true});
const fixtures={},measurements=[];
for(const [id,c] of Object.entries(anchors)){
  const coordinates=[[126.978,37.5665],...c.anchors.map(a=>a.coordinate),[126.978,37.5665]];
  const path=coordinates.map(p=>p.join(',')).join(';');fixtures[path]={};
  for(const geometry of [false,true]){
    const url=new URL('https://flowad-roads.onrender.com/route/v1/driving/'+path);
    url.search=new URLSearchParams({steps:String(geometry),overview:'false',geometries:'geojson',radiuses:coordinates.map(()=>100).join(';'),generate_hints:'false'}).toString();
    const start=performance.now(),r=await fetch(url,{signal:AbortSignal.timeout(20000)}),headersMs=performance.now()-start;
    const text=await r.text(),wallMs=performance.now()-start;
    fixtures[path][geometry?'full':'summary']={status:r.status,text};
    const data=JSON.parse(text);
    measurements.push({id,geometry,httpStatus:r.status,serverDate:r.headers.get('date'),bytes:Buffer.byteLength(text),headersWallMs:Math.round(headersMs),bodyWallMs:Math.round(wallMs-headersMs),legs:data.routes?.[0]?.legs?.length,geometryPoints:data.routes?.[0]?.legs?.reduce((n,l)=>n+(l.steps??[]).reduce((s,v)=>s+(v.geometry?.coordinates?.length??0),0),0)??0});
  }
}
await writeFile('.wrangler/profiling/osrm.json',JSON.stringify(fixtures));
await writeFile('.wrangler/profiling/osrm-sizes.json',JSON.stringify(measurements,null,2));
// Local-only workerd entry. Never deploy this replay or label its responses real API results.
await writeFile('.wrangler/profiling/replay.ts',`
import fixtures from './osrm.json';
import {recommendation,recommend} from '../../src/recommendations';
import {quota} from '../../src/repository';
import {httpJson} from '../../src/utils';
const replay=fixtures as Record<string,Record<string,{status:number;text:string}>>;
globalThis.fetch=async(input:RequestInfo|URL)=>{const u=new URL(String(input)),item=replay[u.pathname.split('/').at(-1)!]?.[u.searchParams.get('steps')==='true'?'full':'summary'];if(!item)throw new Error('Unknown public fixture');return new Response(item.text,{status:item.status});};
const input={latitude:37.5665,longitude:126.978,availableMinutes:1440,scenery:'forest',vehicleType:'ev'};
export default {async fetch(request:Request,env:any){
 const mode=new URL(request.url).pathname.slice(1),count=mode==='full'?20:100;let result:unknown;
 for(let i=0;i<count;i++){
  if(mode==='validate'){result=recommendation.parse(input);continue;}
  if(mode==='d1'){await quota(env,'public-cpu-replay',100000);continue;}
  if(mode==='parse'){for(const entry of Object.values(replay))result=JSON.parse(entry.summary.text);continue;}
  if(mode==='read'){for(const path of Object.keys(replay))result=await httpJson('https://fixture.test/route/'+path+'?steps=false');continue;}
  result=await recommend(recommendation.parse(input),{...env,FREE_PLAN_MODE:mode==='full'?'false':'true',ROAD_ROUTING_URL:mode==='compute'?'':'https://fixture.test'});
 }
 return Response.json({mode,count,result,notice:'LOCAL_REPLAY_ONLY'});
}};
`);
await writeFile('.wrangler/profiling/wrangler.json',JSON.stringify({name:'flowad-local-cpu-replay',main:'replay.ts',compatibility_date:'2026-11-12',workers_dev:false,vars:{NAVIGATION_TICKET_SECRET:'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='},d1_databases:[{binding:'DB',database_name:'flowad',migrations_dir:'../../migrations'}]}));
console.log(JSON.stringify(measurements,null,2));
