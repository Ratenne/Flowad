import {it,expect} from 'vitest';
import worker from '../src/index';
import {base,config} from './helpers';
it('retains bounded cleanup and releases its lease when the request is cancelled',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'}),controller=new AbortController(),retained:Promise<unknown>[]=[];
 const request=new Request('https://flowad.test/api/recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base),signal:controller.signal});
 const response=worker.fetch(request,e,{waitUntil(promise:Promise<unknown>){retained.push(promise);}} as ExecutionContext);
 controller.abort();
 expect((await response).status).toBe(503);expect(retained).toHaveLength(1);await Promise.all(retained);
 expect((await e.DB.prepare('SELECT id FROM poi_routing_slots WHERE expires>0').all()).results).toHaveLength(0);
 expect(fetch).not.toHaveBeenCalled();
});
