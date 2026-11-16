import {it,expect} from 'vitest';
import {base,config,external,json} from './helpers';
// Historical experiment contract; production recommend() now always estimates.
import {recommendWithRouting as recommend,recommendation} from '../src/recommendations';
import {resolve} from '../src/tickets';
function provider(coordinates:number[][],index:number,status?:number){return {status:status??(index%3===1?400:200),data:index%3===1||status?{code:'NoSegment'}:{code:'Ok',waypoints:coordinates.map(location=>({location,distance:0})),routes:[{legs:coordinates.slice(1).map(()=>({distance:1000+index*15000,duration:200+index*1000}))}]}};}
function clean(value:unknown):unknown{if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['generatedAt','navigationTicket'].includes(k)).map(([k,v])=>[k,clean(v)]));return value;}
it.each([
 {},{availableMinutes:1440},{availableMinutes:1},{walking:false,scenery:'coast'},{scenery:'open',batteryPercent:10,estimatedRangeKm:200},
 {originSevere:true},{weather:{condition:'rainy',temperatureC:12,windMps:12,source:'mock'}},
 {courseWeather:{yangpyeong:{condition:'sunny',temperatureC:22,windMps:2,source:'mock',severe:true}}},
 {returnLatitude:35.1796,returnLongitude:129.0756}
])('keeps complete recommendation/NoSegment/exclusion/ticket contracts in batch %#',async extra=>{
 const outputs=[];
 for(const batch of [false,true]){
  let calls=0,count=0;
  external((url,init)=>{calls++;
   if(batch){expect(url).toBe('https://batch.test/v1/routes/batch');const rows=JSON.parse(String(init?.body)).routes as {id:string;coordinates:number[][]}[];count=rows.length;return json({version:1,results:rows.map((row,i)=>({id:row.id,...provider(row.coordinates,i)}))});}
   const coordinates=new URL(url).pathname.split('/').at(-1)!.split(';').map(s=>s.split(',').map(Number));return json(provider(coordinates,count++).data,(count-1)%3===1?400:200);
  });
  const env=config({FREE_PLAN_MODE:'true',ROAD_ROUTING_URL:'https://roads.test',...(batch?{OSRM_BATCH_URL:'https://batch.test'}:{})});
  const out=await recommend(recommendation.parse({...base,...extra}),env);
  if(extra.originSevere){expect(calls).toBe(0);expect(out.weatherExcluded).toBe(10);}else if(batch)expect(calls).toBe(1);
  outputs.push({out:clean(out),ticketPoints:await Promise.all(out.courses.map(async c=>(await resolve(c.navigationTicket,env.NAVIGATION_TICKET_SECRET)).route.points)),count});
 }
 expect(outputs[0]).toEqual(outputs[1]);
});
it.each([403,429,503])('preserves provider global failure early-exit counts for %i',async status=>{
 const outputs=[];
 for(const batch of [false,true]){
  let count=0;external((url,init)=>{
   if(batch){const rows=JSON.parse(String(init?.body)).routes as {id:string;coordinates:number[][]}[];return json({version:1,results:rows.map((row,i)=>i===0?{id:row.id,...provider(row.coordinates,i,status)}:{id:row.id,error:'PROVIDER_UNAVAILABLE'})});}
   count++;return json({},status);
  });
  const out=await recommend(recommendation.parse({...base,courseWeather:{yangpyeong:{condition:'sunny',temperatureC:22,windMps:2,source:'mock',severe:true}}}),config({FREE_PLAN_MODE:'true',ROAD_ROUTING_URL:'https://roads.test',...(batch?{OSRM_BATCH_URL:'https://batch.test'}:{})}));
  outputs.push(clean(out));if(!batch)expect(count).toBe(1);expect(out.routingFailed).toBe(1);
 }
 expect(outputs[0]).toEqual(outputs[1]);
});
it.each(['missing','reversed','wrong-id'])('rejects a %s batch and does not make ten fallback requests',async mode=>{
 const fetcher=external((_url,init)=>{const rows=JSON.parse(String(init?.body)).routes as {id:string;coordinates:number[][]}[];const results=rows.map((r,i)=>({id:r.id,...provider(r.coordinates,i)}));if(mode==='reversed')results.reverse();if(mode==='wrong-id')results[0].id='other-course';return json({version:1,results:mode==='missing'?[]:results});});const out=await recommend(recommendation.parse(base),config({FREE_PLAN_MODE:'true',ROAD_ROUTING_URL:'https://roads.test',OSRM_BATCH_URL:'https://batch.test'}));expect(out.courses).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(1);
});
