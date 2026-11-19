import { Hono } from 'hono';
import type { Bindings } from './types';
import { coordinate } from './utils';
import { JusoFailure,lookupJusoAddress } from './juso-address';
export const locations=new Hono<Bindings>();
locations.post('/address',async c=>{
  const raw:unknown=await c.req.json().catch(()=>null),parsed=coordinate.safeParse(raw);
  if(!parsed.success)return c.body(null,400);
  const {latitude:lat,longitude:lon}=parsed.data;
  if(!(lat>=32&&lat<=40&&lon>=124&&lon<=132))return c.body(null,204);
  const key=c.env.JUSO_MAP_API_KEY?.trim();
  if(!key||! /^[A-Za-z0-9._+/=-]+$/.test(key)){c.header('X-Flowad-Status','JUSO_NOT_CONFIGURED');return c.body(null,503);}
  try{
    const match=await lookupJusoAddress(key,lat,lon);
    return match?c.json(match):c.body(null,204);
  }catch(e){c.header('X-Flowad-Status',e instanceof JusoFailure?e.message:'JUSO_UNAVAILABLE');return c.body(null,503);}
});
locations.get('/map-config',c=>{
  // This is the public browser Key ID, never a Naver secret or a JUSO key.
  const keyId=c.env.NAVER_MAP_KEY_ID?.trim();
  if(!keyId||! /^[A-Za-z0-9_-]{4,200}$/.test(keyId))return c.json({error:'NAVER_MAP_NOT_CONFIGURED'},503);
  const keyParameter=c.env.NAVER_MAP_KEY_PARAMETER??'ncpKeyId';
  if(!['ncpKeyId','ncpClientId'].includes(keyParameter))return c.json({error:'NAVER_MAP_NOT_CONFIGURED'},503);
  return c.json({provider:'NAVER',keyId,keyParameter});
});
