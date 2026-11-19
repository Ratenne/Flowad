import {it,expect} from 'vitest';
import {call,config,external,json} from './helpers';
it.each([502,503,504])('reports startup HTTP %s as pending readiness, never verified',async status=>{
 const provider=external(()=>json(null,status));
 const r=await call('/api/navigation/readiness',{}, {env:config({ROAD_ROUTING_URL:'https://roads.test'})});
 expect(r.status).toBe(202);expect(await r.json()).toEqual({ready:false,retryAfterSeconds:20});expect(provider).toHaveBeenCalledOnce();
});
it('requires a valid OSRM response before declaring readiness',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 external(()=>json({code:'Ok',waypoints:[{location:[126.978,37.5665]}]}));
 expect(await (await call('/api/navigation/readiness',{}, {env:e})).json()).toEqual({ready:true});
 external(()=>new Response('loading page'));expect((await call('/api/navigation/readiness',{}, {env:e})).status).toBe(503);
});
it('does not hide rate limits or Cloudflare challenges as readiness',async()=>{
 const e=config({ROAD_ROUTING_URL:'https://roads.test'});
 external(()=>new Response('',{status:429,headers:{'Retry-After':'90'}}));
 const r=await call('/api/navigation/readiness',{}, {env:e});expect(r.status).toBe(503);expect(r.headers.get('Retry-After')).toBe('90');
 external(()=>new Response('',{status:403,headers:{'cf-mitigated':'challenge'}}));
 expect(await (await call('/api/navigation/readiness',{}, {env:e})).json()).toEqual({error:'ROAD_PROVIDER_CHALLENGE'});
});
