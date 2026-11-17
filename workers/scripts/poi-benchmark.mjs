import {getPlatformProxy} from 'wrangler';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {build}=createRequire(new URL('../node_modules/wrangler/package.json',import.meta.url))('esbuild');
await mkdir('.wrangler/bench',{recursive:true});
await build({entryPoints:['src/dynamic-recommendations.ts'],bundle:true,format:'esm',platform:'browser',outfile:'.wrangler/bench/engine.mjs'});
const {generate}=await import(pathToFileURL(resolve('.wrangler/bench/engine.mjs')).href);
const platform=await getPlatformProxy({configPath:'wrangler.local.jsonc'}),db=platform.env.DB;
const original=globalThis.fetch;
let calls=0;
globalThis.fetch=async(raw,init)=>{
 const url=new URL(String(raw));if(url.hostname!=='roads.mock'){
  if(['127.0.0.1','localhost'].includes(url.hostname))return original(raw,init);
  throw Error('Benchmark external requests forbidden');
 }
 calls++;const coords=url.pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number));
 const meters=(a,b)=>Math.hypot((a[0]-b[0])*88000,(a[1]-b[1])*111000)*1.3;
 const data=url.pathname.includes('/table/')?{code:'Ok',sources:coords.map(location=>({location,distance:0})),durations:coords.map(a=>coords.map(b=>meters(a,b)/14)),distances:coords.map(a=>coords.map(b=>meters(a,b)))}:
 {code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map((b,i)=>({distance:meters(coords[i],b),duration:meters(coords[i],b)/14,steps:[{geometry:{coordinates:[coords[i],b]}}]}))}]};
 return Response.json(data);
};
const report={mode:'REAL_NATIONAL_OSM_LOCAL_D1_WITH_OSRM_MOCK',results:[]};
try{
 for(const [city,latitude,longitude] of [['서울',37.5665,126.978],['부산',35.1796,129.0756],['대구',35.8714,128.6014],['제주',33.4996,126.5312],['강원',37.74,128.75],['저밀도',34.9,126.4]]){
  const before=calls,cpu=process.cpuUsage(),start=performance.now();
  const result=await generate({latitude,longitude,availableMinutes:180,scenery:'all',vehicleType:'ice'}, {...platform.env,ROAD_ROUTING_URL:'https://roads.mock'});
  const usage=process.cpuUsage(cpu);report.results.push({city,courses:result.courses.length,status:result.status,elapsedMs:Math.round(performance.now()-start),nodeCpuMs:(usage.user+usage.system)/1000,nodeRssBytes:process.memoryUsage().rss,osrmMockCalls:calls-before,diagnostics:result.diagnostics});
 }
 const at='2026-11-16',id='budget-probe';
 await db.prepare('INSERT OR IGNORE INTO poi_datasets VALUES(?,?,?,?,?,?)').bind(id,'PROBE',at,at,'TEST','STAGING').run();
 const a=await db.prepare('INSERT INTO pois(dataset_id,id,provider,source_id,name,normalized_name,latitude,longitude,category,scenery,quality,access_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,id,'PROBE',id,id,id,37.5,127,'viewpoint','open','NAMED_COORDINATE','POSSIBLE_ACCESS',at,at).run();
 const b=await db.prepare('INSERT INTO poi_sources VALUES(?,?,?,?,?,?,?)').bind(id,id,'PROBE',id,'{}',at,'TEST').run();
 const c=await db.prepare('INSERT INTO poi_access_points VALUES(?,?,?,?,?,?,?,?)').bind(id,id,'ROAD_CANDIDATE',37.5,127,'POSSIBLE_ACCESS','TEST',null).run();
 report.normalizedWriteProbe={poi:a.meta.rows_written,source:b.meta.rows_written,access:c.meta.rows_written,estimatedNationalWrites:(a.meta.rows_written+b.meta.rows_written+c.meta.rows_written)*42085};
 await db.prepare('DELETE FROM pois WHERE dataset_id=?').bind(id).run();await db.prepare('DELETE FROM poi_datasets WHERE id=?').bind(id).run();
 await mkdir('../data/generated',{recursive:true});await writeFile('../data/generated/local-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{globalThis.fetch=original;await platform.dispose();}
