import {it,expect} from 'vitest';
import {config,external,json} from './helpers';
import {mapGooglePlace,cleanupGooglePlaces} from '../src/google-places';
import {point} from '../src/routing';
import {now} from '../src/utils';
const poi={...point(1,'SCENIC_WAYPOINT','합성 전망대',35,129),poiId:'osm:node:1',region:'부산'};
const env=()=>config({GOOGLE_PLACE_MAPPING_ENABLED:'true',GOOGLE_PLACES_KEY:'mock-only'});
it('deduplicates searches, enforces field masks, caches verified IDs and expires location data',async()=>{
 const e=env(),masks:string[]=[];
 const http=external((url,init)=>{
  const mask=new Headers(init?.headers).get('X-Goog-FieldMask')!;masks.push(mask);
  if(url.endsWith(':searchText')){expect(JSON.parse(String(init?.body))).toMatchObject({textQuery:'합성 전망대 부산',pageSize:3});return json({places:[{id:'SyntheticPlaceA'}]});}
  return json({location:{latitude:35,longitude:129}});
 });
 const results=await Promise.all([mapGooglePlace(poi,e),mapGooglePlace({...poi,order:3},e)]);
 expect(results.map(r=>[r.status,r.order])).toEqual([['MAPPED',1],['MAPPED',3]]);
 expect(masks).toEqual(['places.id','location']);
 expect((await mapGooglePlace(poi,e)).cached).toBe(true);expect(http).toHaveBeenCalledTimes(2);
 await e.DB.prepare('UPDATE google_place_mappings SET reference_expires=?').bind(now()-1).run();
 await cleanupGooglePlaces(e);
 expect(await e.DB.prepare('SELECT reference_json,place_id FROM google_place_mappings').first()).toEqual({reference_json:null,place_id:'SyntheticPlaceA'});
 expect((await mapGooglePlace(poi,e)).status).toBe('MAPPED');expect(masks).toEqual(['places.id','location','location']);
});
it('blocks private points, missing keys, ambiguous results and exhausted daily budgets',async()=>{
 const e={...env(),GOOGLE_PLACES_SEARCH_DAILY_LIMIT:'1'};
 const http=external(url=>url.endsWith(':searchText')?json({places:[{id:'SyntheticPlaceA'},{id:'SyntheticPlaceB'}]}):json({location:{latitude:35,longitude:129}}));
 expect((await mapGooglePlace({...poi,type:'RETURN'},e)).reason).toBe('PUBLIC_POI_REQUIRED');
 expect((await mapGooglePlace(poi,{...e,GOOGLE_PLACES_KEY:undefined})).reason).toBe('GOOGLE_PLACES_NOT_CONFIGURED');
 expect(http).not.toHaveBeenCalled();
 expect((await mapGooglePlace(poi,e)).reason).toBe('GOOGLE_PLACE_MATCH_UNCERTAIN');
 expect((await mapGooglePlace(poi,e)).cached).toBe(true);
 expect((await mapGooglePlace({...poi,poiId:'osm:node:2'},e)).reason).toBe('GOOGLE_PLACES_DAILY_LIMIT');
 expect(http).toHaveBeenCalledTimes(3);
});
