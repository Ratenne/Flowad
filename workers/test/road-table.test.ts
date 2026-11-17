import {it,expect,vi} from 'vitest';
import {matrix} from '../src/dynamic-recommendations';
import {point} from '../src/routing';
import {Failure} from '../src/utils';
import {config,external,json} from './helpers';
import {roadSimplified} from '../src/routing';
const points=[point(0,'ORIGIN','private origin',37.5,127),point(1,'SCENIC_WAYPOINT','candidate',37.501,127.001),point(2,'RETURN','private return',37.5,127)];
const env=()=>config({ROAD_ROUTING_URL:'https://roads.test'});
function table(){return {code:'Ok',sources:points.map(p=>({location:[p.longitude,p.latitude],distance:0})),durations:points.map(()=>points.map(()=>10)),distances:points.map(()=>points.map(()=>100))};}
it.each([403,429])('distinguishes a provider browser challenge from throttling for HTTP %i',async status=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const cancel=vi.fn(),body=new ReadableStream({cancel});
 external(()=>new Response(body,{status,headers:{'cf-mitigated':'challenge','Retry-After':'30'}}));
 await expect(matrix(points,env())).rejects.toMatchObject({code:'ROAD_PROVIDER_CHALLENGE',status:503,retryAfterSeconds:undefined});
 expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({httpStatus:status,reason:'provider_challenge'});
 expect(cancel).toHaveBeenCalledOnce();
 external(()=>new Response('private challenge tokens',{status,headers:{'cf-mitigated':'challenge'}}));
 await expect(roadSimplified(points,env())).rejects.toMatchObject({code:'ROAD_PROVIDER_CHALLENGE',status:503});
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it('preserves challenge classification even when the upstream body has already failed',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});
 external(()=>new Response(new ReadableStream({start(controller){controller.error(Error('private upstream error'));}}),{status:429,headers:{'cf-mitigated':'challenge'}}));
 await expect(matrix(points,env())).rejects.toMatchObject({code:'ROAD_PROVIDER_CHALLENGE',status:503});
});
it('classifies an HTML 429 before JSON parsing and preserves bounded Retry-After',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 external(()=>new Response('<h1>Too many requests</h1>',{status:429,headers:{'Retry-After':'17'}}));
 await expect(matrix(points,env())).rejects.toMatchObject({code:'ROAD_PROVIDER_RATE_LIMIT',status:503,retryAfterSeconds:17});
 expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({httpStatus:429,reason:'rate_limit'});
 external(()=>new Response('',{status:429,headers:{'Retry-After':'99999'}}));
 await expect(matrix(points,env())).rejects.toMatchObject({retryAfterSeconds:300});
});
it('disconnects an off-road POI without weakening origin/return or final Route snap limits',async()=>{
 const data=table();data.sources[1].distance=563;data.sources[1].location[1]+=.005;
 external(url=>{expect(new URL(url).searchParams.get('radiuses')).toBe('100;unlimited;100');return json(data);});
 const result=await matrix(points,env());
 expect(result.durations).toEqual([[10,null,10],[null,null,null],[10,null,10]]);
 expect(result.distances).toEqual([[100,null,100],[null,null,null],[100,null,100]]);
});
it.each([
 [400,'NoSegment','no_segment'],[400,'TooBig','table_size_limit'],[400,'InvalidQuery','invalid_request'],[400,'NoTable','no_table'],[503,null,'http_error'],[200,null,'invalid_response']
])('records safe structured diagnostics for HTTP %i / %s',async(status,code,reason)=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 external(()=>json({code,message:'secret provider URL and coordinates'},status));
 await expect(matrix(points,env())).rejects.toMatchObject({code:'ROAD_TABLE_UNAVAILABLE',status:503});
 const output=String(log.mock.calls[0][0]);const entry=JSON.parse(output);
 expect(entry).toMatchObject({event:'osrm_table_failure',httpStatus:status,osrmCode:code,coordinateCount:3,reason});
 expect(entry.elapsedMs).toBeGreaterThanOrEqual(0);expect(output).not.toMatch(/secret|127|37\.5|private/);
});
it.each(['invalid_json','invalid_matrix','invalid_snap','connection_failure','timeout','response_too_large','cancelled'])('classifies %s without leaking provider content',async reason=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{}),controller=new AbortController();
 external(()=>{
  if(reason==='invalid_json')return new Response('not JSON');
  if(reason==='connection_failure')throw Error('sensitive URL');
  if(reason==='timeout')throw new Failure('UPSTREAM_TIMEOUT');
  if(reason==='response_too_large')throw new Failure('RESPONSE_TOO_LARGE');
  if(reason==='cancelled'){controller.abort();throw Error('cancelled URL');}
  const data=table();if(reason==='invalid_matrix')data.durations[0].pop();else data.sources[0].distance=-1;
  return json(data);
 });
 await expect(matrix(points,env(),controller.signal)).rejects.toMatchObject({status:503});
 expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({reason,coordinateCount:3});
});
it('fails a distant origin instead of disconnecting it or fabricating a route',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});const data=table();data.sources[0].distance=101;external(()=>json(data));
 await expect(matrix(points,env())).rejects.toMatchObject({code:'WAYPOINT_TOO_FAR_FROM_ROAD',status:503});
});
it('preserves null edges for disconnected islands',async()=>{
 const data=table() as Omit<ReturnType<typeof table>,'durations'>&{durations:(number|null)[][]};data.durations[0][1]=null;external(()=>json(data));
 expect((await matrix(points,env())).durations[0][1]).toBeNull();
});
