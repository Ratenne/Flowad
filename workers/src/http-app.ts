import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import type {Bindings} from './types';
import {Failure} from './utils';
import {quota} from './repository';

// One implementation of the existing HTTP/security contract for both entries.
export function createApiApp(methods:Record<string,'GET'|'POST'>){
 const app=new Hono<Bindings>();
 app.use('*',async(c,next)=>{
  c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Content-Type-Options','nosniff');
  const origin=c.req.header('Origin'),allowed=(c.env.ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean),same=new URL(c.req.url).origin;
  if(origin&&origin!==same&&!allowed.includes(origin))return c.json({error:'ORIGIN_NOT_ALLOWED'},403);
  if(origin){c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');c.header('Access-Control-Allow-Credentials','true');c.header('Access-Control-Expose-Headers','X-Flowad-Status');}
  if(c.req.method==='OPTIONS'){c.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');c.header('Access-Control-Allow-Headers','Content-Type,X-CSRF-Token');return c.body(null,204);}
  await next();
 });
 app.use('*',async(c,next)=>bodyLimit({maxSize:c.env.FREE_PLAN_MODE==='true'?131072:2_000_000,onError:c=>c.json({error:'REQUEST_TOO_LARGE'},413)})(c,next));
 app.use('/api/*',async(c,next)=>{
  const method=methods[c.req.path];
  if(method&&c.req.method!==method){c.header('Allow',method);return c.json({error:'METHOD_NOT_ALLOWED'},405);}
  const contentType=(c.req.header('Content-Type')??'').split(';')[0].toLowerCase();
  if(c.req.path==='/api/location/juso-map'&&contentType!=='application/x-www-form-urlencoded')return c.json({error:'UNSUPPORTED_MEDIA_TYPE'},415);
  const jsonBody=method==='POST'&&!['/api/location/juso-map','/api/tesla/authorize','/api/tesla/disconnect','/api/tesla/vehicles','/api/tesla/reading','/api/tesla/location'].includes(c.req.path);
  if(jsonBody&&contentType!=='application/json'&&!/^application\/[\w.+-]+\+json$/.test(contentType))return c.json({error:'UNSUPPORTED_MEDIA_TYPE'},415);
  await next();
 });
 app.use('/api/*',async(c,next)=>{await quota(c.env,`ip:${c.req.header('CF-Connecting-IP')??'local'}`,120);await next();});
 app.notFound(c=>c.json({error:'NOT_FOUND'},404));
 app.onError((error,c)=>{
  if(error instanceof Failure)return c.json({error:error.code},error.status);
  if(error instanceof z.ZodError||error instanceof SyntaxError)return c.json({error:'INVALID_REQUEST'},400);
  return c.json({error:'SERVICE_UNAVAILABLE'},503);
 });
 return app;
}
