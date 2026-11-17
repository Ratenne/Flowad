import type {Env} from './types';
import {distance} from './utils';
export interface Poi {id:string;name:string;latitude:number;longitude:number;category:string;scenery:string;region:string;description:string|null;quality:string;access_status:string;provider:string;source_updated_at:string;attributes_json:string;access_latitude:number;access_longitude:number;access_kind:string;approachKm?:number;attractionScore?:number}
export async function nearby(env:Env,lat:number,lng:number,radiusKm:number,limit=32,ids?:string[],minimumKm=0):Promise<Poi[]>{
 const dy=radiusKm/110.5,dx=dy/Math.max(.5,Math.cos(lat*Math.PI/180));
 const ring=[lat,lat,lng,lng,Math.cos(lat*Math.PI/180)**2,(minimumKm/110.5)**2];
 const result=await env.DB.prepare(`SELECT p.*,s.source_updated_at,s.attributes_json,
 COALESCE(a.latitude,p.latitude) access_latitude,COALESCE(a.longitude,p.longitude) access_longitude,COALESCE(a.kind,'POI_REPRESENTATIVE') access_kind
 FROM poi_spatial r JOIN pois p ON p.rowid=r.id
 JOIN poi_provider_state active ON active.active_dataset=p.dataset_id
 JOIN poi_sources s ON s.dataset_id=p.dataset_id AND s.poi_id=p.id
 LEFT JOIN poi_access_points a ON a.dataset_id=p.dataset_id AND a.poi_id=p.id
 AND a.kind=(SELECT kind FROM poi_access_points b WHERE b.dataset_id=p.dataset_id AND b.poi_id=p.id ORDER BY CASE b.kind WHEN 'PARKING_CANDIDATE' THEN 0 WHEN 'ROAD_CANDIDATE' THEN 1 ELSE 2 END LIMIT 1)
 WHERE r.min_lat<=? AND r.max_lat>=? AND r.min_lon<=? AND r.max_lon>=?
 AND NOT EXISTS(SELECT 1 FROM poi_storage ps WHERE ps.dataset_id=p.dataset_id AND ps.format='CELLS')
 AND p.deleted_at IS NULL AND p.duplicate_of IS NULL AND p.access_status!='NO_CAR_ACCESS' AND a.kind!='POI_REPRESENTATIVE'
 AND ((p.latitude-?)*(p.latitude-?)+(p.longitude-?)*(p.longitude-?)*?)>=?
 ${ids?.length?'AND p.id IN ('+ids.map(()=>'?').join(',')+')':''}
 ORDER BY (p.latitude-?)*(p.latitude-?)+(p.longitude-?)*(p.longitude-?) LIMIT ?`)
 .bind(lat+dy,lat-dy,lng+dx,lng-dx,...ring,...(ids??[]),lat,lat,lng,lng,limit*4).all<Poi>();
 const cells=await env.DB.prepare(`SELECT json_extract(j.value,'$.id') id,json_extract(j.value,'$.name') name,
 json_extract(j.value,'$.latitude') latitude,json_extract(j.value,'$.longitude') longitude,
 json_extract(j.value,'$.category') category,json_extract(j.value,'$.scenery') scenery,json_extract(j.value,'$.region') region,
 json_extract(j.value,'$.description') description,json_extract(j.value,'$.quality') quality,json_extract(j.value,'$.access_status') access_status,
 json_extract(j.value,'$.provider') provider,json_extract(j.value,'$.source_updated_at') source_updated_at,
 json_extract(j.value,'$.attributes_json') attributes_json,json_extract(j.value,'$.access_latitude') access_latitude,
 json_extract(j.value,'$.access_longitude') access_longitude,json_extract(j.value,'$.access_kind') access_kind
 FROM poi_cell_spatial r JOIN poi_cells c ON c.rowid=r.id JOIN poi_provider_state s ON s.active_dataset=c.dataset_id,
 json_each(c.records_json) j
 WHERE r.min_lat<=? AND r.max_lat>=? AND r.min_lon<=? AND r.max_lon>=?
 AND json_extract(j.value,'$.deleted_at') IS NULL AND json_extract(j.value,'$.duplicate_of') IS NULL
 AND json_extract(j.value,'$.access_status')!='NO_CAR_ACCESS' AND json_extract(j.value,'$.access_kind')!='POI_REPRESENTATIVE'
 AND ((latitude-?)*(latitude-?)+(longitude-?)*(longitude-?)*?)>=?
 ${ids?.length?"AND json_extract(j.value,'$.id') IN ("+ids.map(()=>'?').join(',')+')':''}
 ORDER BY (latitude-?)*(latitude-?)+(longitude-?)*(longitude-?) LIMIT ?`)
 .bind(lat+dy,lat-dy,lng+dx,lng-dx,...ring,...(ids??[]),lat,lat,lng,lng,limit*4).all<Poi>();
 // The RTree bounded the read; only these candidates use Haversine.
 const seen=new Set<string>();
 return [...result.results,...cells.results].map(p=>({...p,approachKm:distance(lat,lng,p.latitude,p.longitude)}))
 .filter(p=>p.approachKm!<=radiusKm&&p.approachKm!>=minimumKm*.98).sort((a,b)=>a.approachKm!-b.approachKm!)
 .filter(p=>{const key=p.name.replace(/\s/g,'')+':'+Math.round(p.latitude*1000)+':'+Math.round(p.longitude*1000);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
}
