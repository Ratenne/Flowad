import type {Hono} from 'hono';
import {z} from 'zod';
import type {Bindings} from './types';
import {recommendation,recommend} from './recommendations';
import {resolve} from './tickets';
import {selectedRequest,verifySelected} from './selected-route';
import {Failure} from './utils';
export const recommendationMethods={'/api/recommendations':'POST','/api/navigation/resolve':'POST','/api/navigation/verify':'POST'} as const;
export function mountRecommendationApi(app:Hono<Bindings>){
 app.post('/api/recommendations',async c=>{
  const raw:unknown=await c.req.json().catch(()=>null),r=recommendation.safeParse(raw);
  if(!r.success)return c.json({error:'Invalid recommendation request'},400);
  return c.json(await recommend(r.data,c.env));
 });
 app.post('/api/navigation/resolve',async c=>{
  try{const r=z.object({ticket:z.string()}).parse(await c.req.json());return c.json(await resolve(r.ticket,c.env.NAVIGATION_TICKET_SECRET));}catch{return c.body(null,400);}
 });
 app.post('/api/navigation/verify',async c=>{
  const parsed=selectedRequest.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({verificationStatus:'ROAD_ROUTE_UNAVAILABLE',roadVerified:false,error:'INVALID_REQUEST'},400);
  try{return c.json(await verifySelected(parsed.data,c.env));}
  catch(e){const error=e instanceof Failure?e:new Failure('SERVICE_UNAVAILABLE',503);return c.json({verificationStatus:'ROAD_ROUTE_UNAVAILABLE',roadVerified:false,error:error.code},error.status);}
 });
}
