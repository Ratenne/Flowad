import {z} from 'zod';
import type {Env,Point,GooglePlaceReference} from './types';
import {assessGooglePlace,googlePlaceReference} from './google-place-mapping';
import {coordinate,distance,Failure,hash,httpJson,nonce,now} from './utils';

export const googlePlacesPolicy=Object.freeze({candidates:3,requestMs:3500,operationMs:45000,cacheSeconds:7*86400,
 failureSeconds:86400,transientSeconds:300,maxAutomaticDistanceMeters:10,minAlternativeDistanceMeters:50,
 searchDaily:20,detailsDaily:60,searchMonthly:600,detailsMonthly:1800,concurrency:2});
type Row={point_hash:string;place_id:string|null;reference_json:string|null;reference_expires:number;state:string;reason:string|null;retry_after:number};
export type MappingResult={order:number;name:string;status:string;reason?:string;cached?:boolean;retryAfterSeconds?:number;reference?:GooglePlaceReference};
const inFlight=new Map<string,Promise<MappingResult>>();
const placeId=z.string().min(10).max(512).regex(/^[A-Za-z0-9_-]+$/);
function limit(value:string|undefined,fallback:number,maximum:number){const n=Number(value);return Number.isInteger(n)&&n>0?Math.min(n,maximum):fallback;}
function periods(){const date=new Date((now()+9*3600)*1000).toISOString();return {day:date.slice(0,10),month:date.slice(0,7)};}
function nextDay(){return (Math.floor((now()+9*3600)/86400)+1)*86400-9*3600;}
async function reserve(env:Env,sku:'SEARCH_IDS'|'DETAILS_LOCATION'){
 const p=periods(),daily=sku==='SEARCH_IDS'?limit(env.GOOGLE_PLACES_SEARCH_DAILY_LIMIT,20,100):limit(env.GOOGLE_PLACES_DETAILS_DAILY_LIMIT,60,300);
 for(const [period,cap] of [[p.day,daily],[p.month,sku==='SEARCH_IDS'?googlePlacesPolicy.searchMonthly:googlePlacesPolicy.detailsMonthly]] as const){
  const row=await env.DB.prepare('INSERT INTO google_places_usage(period,sku,count) VALUES(?,?,1) ON CONFLICT(period,sku) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(period,sku,cap).first();
  if(!row)throw new Failure(period===p.day?'GOOGLE_PLACES_DAILY_LIMIT':'GOOGLE_PLACES_MONTHLY_LIMIT',429);
 }
}
async function request(env:Env,url:string,init:RequestInit,sku:'SEARCH_IDS'|'DETAILS_LOCATION',signal?:AbortSignal){
 await reserve(env,sku);
 let r;try{r=await httpJson(url,{...init,signal},googlePlacesPolicy.requestMs);}catch{throw new Failure('GOOGLE_PLACES_UNAVAILABLE',503);}
 if(r.status===429)throw new Failure('GOOGLE_PLACES_RATE_LIMIT',429);
 if([400,401,403].includes(r.status))throw new Failure('GOOGLE_PLACES_CONFIGURATION_ERROR',503);
 if(r.status!==200)throw new Failure('GOOGLE_PLACES_UNAVAILABLE',503);
 return r.data;
}
async function read(env:Env,id:string){return env.DB.prepare('SELECT point_hash,place_id,reference_json,reference_expires,state,reason,retry_after FROM google_place_mappings WHERE poi_id=?').bind(id).first<Row>();}
function cached(point:Point,fingerprint:string,row:Row|null):MappingResult|undefined{
 if(!row||row.point_hash!==fingerprint)return;
 if(row.reference_json&&row.reference_expires>now()){
  let value:unknown;try{value=JSON.parse(row.reference_json);}catch{return;}
  const result=assessGooglePlace(point,value);if(!('reason'in result))return {order:point.order,name:point.name,status:'MAPPED',reference:result.reference,cached:true};
 }
 if(row.retry_after>now())return {order:point.order,name:point.name,status:'UNMAPPED',reason:row.reason??'GOOGLE_PLACE_MATCH_UNCERTAIN',cached:true,retryAfterSeconds:row.retry_after-now()};
}
export async function mapGooglePlace(point:Point,env:Env,signal?:AbortSignal):Promise<MappingResult>{
 const existing=assessGooglePlace(point,point.googlePlace);
 if(!('reason'in existing))return {order:point.order,name:point.name,status:'MAPPED',reference:existing.reference,cached:true};
 const fail=(reason:string):MappingResult=>({order:point.order,name:point.name,status:'UNMAPPED',reason});
 // Generic origins/returns are not public OSM POIs. Never send private user
 // coordinates or a generic "return point" query to Google.
 if(!point.poiId?.match(/^osm:(node|way|relation):\d+$/)||!point.region?.trim()||!['SCENIC_WAYPOINT','DESTINATION'].includes(point.type))return fail('PUBLIC_POI_REQUIRED');
 if(env.GOOGLE_PLACE_MAPPING_ENABLED!=='true')return fail('GOOGLE_PLACE_MAPPING_DISABLED');
 const fingerprint=await hash(JSON.stringify([point.poiId,point.name,point.region,point.latitude,point.longitude,point.poiLocation]));
 const row=await read(env,point.poiId),hit=cached(point,fingerprint,row);if(hit)return hit;
 if(row?.point_hash===fingerprint&&row.reference_json&&row.reference_expires>now())await env.DB.prepare('UPDATE google_place_mappings SET reference_json=NULL,reference_expires=0 WHERE poi_id=? AND point_hash=?').bind(point.poiId,fingerprint).run();
 if(!env.GOOGLE_PLACES_KEY)return fail('GOOGLE_PLACES_NOT_CONFIGURED');
 const key=await hash(env.NAVIGATION_TICKET_SECRET+fingerprint);
 if(inFlight.has(key)){const result=await inFlight.get(key)!;return {...result,order:point.order,name:point.name};}
 const pending=mapUncached(point,env,fingerprint,signal);inFlight.set(key,pending);
 try{return await pending;}finally{inFlight.delete(key);}
}
async function mapUncached(point:Point,env:Env,fingerprint:string,signal?:AbortSignal):Promise<MappingResult>{
 const id=point.poiId!,owner=nonce(),base={order:point.order,name:point.name};
 const claimed=await env.DB.prepare(`INSERT INTO google_place_mappings(poi_id,point_hash,state,lease_owner,lease_until,updated_at) VALUES(?,?,'PENDING',?,?,?)
 ON CONFLICT(poi_id) DO UPDATE SET place_id=CASE WHEN point_hash=excluded.point_hash THEN place_id ELSE NULL END,reference_json=CASE WHEN point_hash=excluded.point_hash THEN reference_json ELSE NULL END,reference_expires=CASE WHEN point_hash=excluded.point_hash THEN reference_expires ELSE 0 END,point_hash=excluded.point_hash,state='PENDING',lease_owner=excluded.lease_owner,lease_until=excluded.lease_until,updated_at=excluded.updated_at
 WHERE lease_until<? AND (point_hash!=excluded.point_hash OR (reference_expires<=? AND retry_after<=?)) RETURNING poi_id`)
 .bind(id,fingerprint,owner,now()+50,now(),now(),now(),now()).first();
 if(!claimed)return cached(point,fingerprint,await read(env,id))??{...base,status:'PENDING',reason:'GOOGLE_PLACE_MAPPING_IN_PROGRESS'};
 let slot:{id:number}|null=null;
 const failed=async(reason:string,seconds:number):Promise<MappingResult>=>{
  await env.DB.prepare("UPDATE google_place_mappings SET state='FAILED',reason=?,retry_after=?,reference_json=NULL,reference_expires=0,lease_owner=NULL,lease_until=0,updated_at=? WHERE poi_id=? AND lease_owner=?")
  .bind(reason,now()+seconds,now(),id,owner).run();
  return {...base,status:'UNMAPPED',reason,retryAfterSeconds:seconds};
 };
 try{
  slot=await env.DB.prepare('UPDATE google_places_slots SET lease=?,expires=? WHERE id=(SELECT id FROM google_places_slots WHERE expires<? ORDER BY id LIMIT 1) RETURNING id').bind(owner,now()+50,now()).first<{id:number}>();
  if(!slot)return await failed('GOOGLE_PLACE_MAPPING_BUSY',3);
  signal?.throwIfAborted();
  const current=await read(env,id),savedId=current?.point_hash===fingerprint?current.place_id:null;
  let ids:string[];
  if(savedId&&placeId.safeParse(savedId).success)ids=[savedId];
  else{
   const raw=await request(env,'https://places.googleapis.com/v1/places:searchText',{
    method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_PLACES_KEY!,'X-Goog-FieldMask':'places.id'},
    body:JSON.stringify({textQuery:point.name+' '+point.region,regionCode:'KR',languageCode:'ko',pageSize:googlePlacesPolicy.candidates,
     locationBias:{circle:{center:point.poiLocation??{latitude:point.latitude,longitude:point.longitude},radius:200}}})
   },'SEARCH_IDS',signal);
   const parsed=z.object({places:z.array(z.object({id:placeId})).max(googlePlacesPolicy.candidates).optional()}).safeParse(raw);
   if(!parsed.success)throw new Failure('GOOGLE_PLACES_INVALID_RESPONSE',503);
   ids=[...new Set((parsed.data.places??[]).map(p=>p.id))];
  }
  if(!ids.length)return await failed('GOOGLE_PLACE_NOT_FOUND',googlePlacesPolicy.failureSeconds);
  const candidates:Array<{id:string;location:{latitude:number;longitude:number};meters:number}>=[];
  for(const candidate of ids){
   signal?.throwIfAborted();
   const raw=await request(env,'https://places.googleapis.com/v1/places/'+encodeURIComponent(candidate),{
    headers:{'X-Goog-Api-Key':env.GOOGLE_PLACES_KEY!,'X-Goog-FieldMask':'location'}
   },'DETAILS_LOCATION',signal);
   const parsed=z.object({location:coordinate}).safeParse(raw);if(!parsed.success)throw new Failure('GOOGLE_PLACES_INVALID_RESPONSE',503);
   candidates.push({id:candidate,location:parsed.data.location,meters:distance(point.latitude,point.longitude,parsed.data.location.latitude,parsed.data.location.longitude)*1000});
  }
  candidates.sort((a,b)=>a.meters-b.meters);
  const osm=point.poiLocation??point;
  const match=candidates[0].location;
  if(distance(osm.latitude,osm.longitude,match.latitude,match.longitude)*1000>googlePlacesPolicy.maxAutomaticDistanceMeters)return await failed('GOOGLE_PLACE_LOCATION_MISMATCH',googlePlacesPolicy.failureSeconds);
  if(candidates[0].meters>googlePlacesPolicy.maxAutomaticDistanceMeters)return await failed('GOOGLE_PLACE_LOCATION_MISMATCH',googlePlacesPolicy.failureSeconds);
  if(candidates.slice(1).some(c=>c.meters<googlePlacesPolicy.minAlternativeDistanceMeters))return await failed('GOOGLE_PLACE_MATCH_UNCERTAIN',googlePlacesPolicy.failureSeconds);
  const reference=googlePlaceReference.parse({id:candidates[0].id,source:'GOOGLE_PLACES',verifiedAt:new Date().toISOString(),identityConfirmed:true,
   verificationMethod:'TEXT_QUERY_UNIQUE_LOCATION',nameVerified:false,location:candidates[0].location,matchedPoint:{name:point.name,latitude:point.latitude,longitude:point.longitude}});
  // Persist only ID + bounded coordinate verification, never names/addresses
  // fetched from Google. The ID may remain after reference_json is purged.
  await env.DB.prepare("UPDATE google_place_mappings SET place_id=?,reference_json=?,reference_expires=?,state='MAPPED',reason=NULL,retry_after=0,lease_owner=NULL,lease_until=0,updated_at=? WHERE poi_id=? AND lease_owner=?")
  .bind(reference.id,JSON.stringify(reference),now()+googlePlacesPolicy.cacheSeconds,now(),id,owner).run();
  return {...base,status:'MAPPED',reference,cached:false};
 }catch(error){
  const reason=error instanceof Failure?error.code:'GOOGLE_PLACES_UNAVAILABLE';
  return await failed(reason,reason==='GOOGLE_PLACES_DAILY_LIMIT'?Math.max(1,nextDay()-now()):reason==='GOOGLE_PLACES_MONTHLY_LIMIT'?86400:googlePlacesPolicy.transientSeconds);
 }finally{
  if(slot)await env.DB.prepare('UPDATE google_places_slots SET lease=NULL,expires=0 WHERE id=? AND lease=?').bind(slot.id,owner).run();
 }
}
export async function cleanupGooglePlaces(env:Env){
 await env.DB.prepare('UPDATE google_place_mappings SET reference_json=NULL,reference_expires=0 WHERE poi_id IN (SELECT poi_id FROM google_place_mappings WHERE reference_json IS NOT NULL AND reference_expires<=? LIMIT 500)').bind(now()).run();
 const cutoff=new Date((now()-90*86400)*1000).toISOString().slice(0,7);
 await env.DB.prepare('DELETE FROM google_places_usage WHERE period<?').bind(cutoff).run();
}
