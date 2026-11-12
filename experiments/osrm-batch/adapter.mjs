// Sequential adapter: preserves the existing provider-failure early-stop order.
// No dependencies, coordinate logs, retries, persistent request data or caching.
export const BODY_LIMIT=16384,RESPONSE_LIMIT=4_000_000;
export function validate(input){
 if(!input||input.version!==1||!Array.isArray(input.routes)||input.routes.length<1||input.routes.length>10)throw Error('INVALID_BATCH');
 const ids=new Set();
 for(const row of input.routes){
  if(!row||typeof row.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(row.id)||ids.has(row.id)||!Array.isArray(row.coordinates)||row.coordinates.length<2||row.coordinates.length>20)throw Error('INVALID_BATCH');
  ids.add(row.id);
  for(const p of row.coordinates)if(!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(p[0])>180||Math.abs(p[1])>90)throw Error('INVALID_BATCH');
 }
 return input.routes;
}
function thin(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 return {code:value.code,waypoints:Array.isArray(value.waypoints)?value.waypoints.map(w=>w&&typeof w==='object'?{location:w.location,distance:w.distance}:w):value.waypoints,
  routes:Array.isArray(value.routes)?value.routes.slice(0,1).map(r=>r&&typeof r==='object'?{legs:Array.isArray(r.legs)?r.legs.map(l=>l&&typeof l==='object'?{distance:l.distance,duration:l.duration}:l):r.legs}:r):value.routes};
}
export async function readBounded(response){
 if(Number(response.headers.get('content-length'))>RESPONSE_LIMIT)throw Error('RESPONSE_LIMIT');
 const chunks=[];let size=0;const reader=response.body?.getReader();
 if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>RESPONSE_LIMIT){await reader.cancel();throw Error('RESPONSE_LIMIT');}chunks.push(value);}
 const raw=Buffer.concat(chunks,size);let data=null;try{data=JSON.parse(raw.toString('utf8'));}catch{}
 return {data,bytes:size};
}
export async function execute(routes,{base,fetcher=fetch,timeoutMs=8000}={}){
 const results=[];let stopped=false,upstreamBytes=0,calls=0,upstreamWallMs=0;
 for(const row of routes){
  if(stopped){results.push({id:row.id,error:'PROVIDER_UNAVAILABLE'});continue;}
  const started=performance.now();
  try{
   const path=row.coordinates.map(p=>p.join(',')).join(';');
   const url=base+'/route/v1/driving/'+path+'?steps=false&geometries=geojson&overview=false&generate_hints=false&radiuses='+row.coordinates.map(()=>100).join(';');
   calls++;
   const response=await fetcher(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'manual'}),body=await readBounded(response);
   upstreamBytes+=body.bytes;
   results.push({id:row.id,status:response.status,data:thin(body.data)});
   if(response.status!==200&&response.status!==400)stopped=true;
  }catch{results.push({id:row.id,error:'PROVIDER_UNAVAILABLE'});stopped=true;}
  finally{upstreamWallMs+=performance.now()-started;}
 }
 return {version:1,results,metrics:{upstreamCalls:calls,upstreamBytes,upstreamWallMs:Math.round(upstreamWallMs*100)/100}};
}
