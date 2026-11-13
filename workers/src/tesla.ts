import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Bindings, Env, Plan, Route, Session } from './types';
import { Sessions, type Lease, quota } from './repository';
import { AUDIENCE, acceptTokens, configured, hasScope, TeslaClient } from './tesla-client';
import { coordinate, Failure, hash, nonce, now, round } from './utils';
import { destination } from './routing';
import {selectedRequest,vehicleConditions,verifySelected,verifySelection} from './selected-route';

const response=z.object({response:z.unknown()});
function payload(raw:unknown){const parsed=response.safeParse(raw);if(!parsed.success)throw new Failure('INVALID_RESPONSE');return parsed.data.response;}
const vehicle=z.object({vin:z.string().min(1),display_name:z.string().nullable().optional(),state:z.string().optional()});
const info=z.object({state:z.string().optional(),granular_access:z.object({hide_private:z.boolean().optional()}).optional()});
const charge=z.object({charge_state:z.object({battery_level:z.number().int().nullable().optional(),est_battery_range:z.number().nullable().optional(),timestamp:z.number().nullable().optional()}).nullable().optional()});
const location=z.object({drive_state:coordinate.extend({timestamp:z.number().nullable().optional()})});
type Context=import('hono').Context<Bindings>;
const cookie='__Host-flowad';
function secure(c: Context){return new URL(c.req.url).protocol==='https:';}
function requireSecure(c: Context){if(!secure(c))throw new Failure('HTTPS_REQUIRED',403);}
function setSession(c: Context,id:string){setCookie(c,cookie,id,{secure:true,httpOnly:true,sameSite:'Lax',path:'/',maxAge:1800});}
function requireCsrf(c: Context,s: Session){requireSecure(c);if(!s.csrf||c.req.header('X-CSRF-Token')!==s.csrf)throw new Failure('INVALID_CSRF',403);}
function pending(s: Session){return s.plan?.pending?s.plan:undefined;}
function selected(s: Session){if(!s.selected||!Object.hasOwn(s.vehicles,s.selected))throw new Failure('NO_VEHICLE_SELECTED');return s.selected;}
function outcome(p: Plan){return {planId:p.id,status:p.status,order:p.attempted,destination:p.stops[p.attempted-1]?.name,vehicleStatus:p.vehicleStatus,requiresVehicleCheck:p.pending,automaticallyVerified:false,...(p.error?{error:p.error}:{}),commandStatus:p.status==='NOT_SENT'?'COMMAND_NOT_SENT':p.status==='API_ACCEPTED'?'COMMAND_SENT':'COMMAND_FAILED',navigationStatus:p.vehicleStatus==='VEHICLE_CONFIRMED'?'NAVIGATION_CONFIRMED':'NAVIGATION_NOT_CONFIRMED',confirmationSource:p.vehicleStatus==='VEHICLE_CONFIRMED'?'USER_REPORTED':'NONE'};}
async function body<T extends z.ZodType>(c: Context,schema:T):Promise<z.infer<T>> {let raw:unknown;try{raw=await c.req.json();}catch{throw new Failure('INVALID_REQUEST');}const r=schema.safeParse(raw);if(!r.success)throw new Failure('INVALID_REQUEST');return r.data;}
function callbackUri(e: Env){if(!configured(e))throw new Failure('NOT_CONFIGURED',503);let u:URL;try{u=new URL(e.TESLA_REDIRECT_URI!);}catch{throw new Failure('NOT_CONFIGURED',503);}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!==`${e.API_PREFIX??''}/api/tesla/callback`)throw new Failure('NOT_CONFIGURED',503);return u.href;}
export const tesla=new Hono<Bindings>();
tesla.get('/status',async c=>{
  let id=getCookie(c,cookie),lease:Lease;
  try{if(!id)throw new Failure('NOT_CONNECTED');lease=await new Sessions(c.env).open(id);}
  catch(e){if(!(e instanceof Failure)||!['NOT_CONNECTED','REAUTH_REQUIRED'].includes(e.code))throw e;id=await new Sessions(c.env).create();lease=await new Sessions(c.env).open(id);}
  const s=lease.data;await lease.save(true);if(secure(c))setSession(c,id!);
  return c.json({connection:s.tokens?'CONNECTED':'NOT_CONNECTED',oauthStatus:s.tokens?'OAUTH_CONNECTED':'NOT_CONNECTED',locationReady:secure(c)&&!!(s.tokens&&s.locationGranted&&s.selected&&s.vehicles[s.selected]),navigation:configured(c.env)?'SINGLE_DESTINATION':'NOT_CONFIGURED',csrf:s.csrf,secure:secure(c),message:'전체 경유지 일괄 전송은 미지원입니다. 단일 목적지 교체만 지원합니다.'});
});
// Every authenticated operation is serialized and saved, including error transitions.
tesla.use('*',async(c,next)=>{
  requireSecure(c);
  const id=getCookie(c,cookie);if(!id)throw new Failure(c.req.path.endsWith('/callback')?'INVALID_STATE':'INVALID_CSRF',c.req.path.endsWith('/callback')?400:403);
  const lease=await new Sessions(c.env).open(id);
  try{
    if(c.req.method!=='GET')requireCsrf(c,lease.data);
    await quota(c.env,`session:${lease.key}`,20);
    // Store in request-local context only, never isolate-global state.
    c.set('lease' as never,lease as never);
    await next();
  } finally {await lease.save(true);}
});
function lease(c:Context){return c.get('lease' as never) as Lease;}
tesla.post('/authorize',async c=>{
  const l=lease(c),s=l.data,uri=callbackUri(c.env),state=nonce();
  // Don't discard unresolved commands by beginning another login flow.
  if(pending(s))throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  const bool=(name:string)=>{const v=c.req.query(name);if(v!==undefined&&v!=='true'&&v!=='false')throw new Failure('INVALID_REQUEST');return v==='true';};
  s.requestedLocation=bool('location');s.requestedCommands=bool('commands');s.commands=false;s.state=await hash(state);s.returnTo=c.req.query('returnTo')==='check'?'tesla-check.html':'';
  await l.state(state);await l.save();
  const q=new URLSearchParams({prompt:'login',response_type:'code',client_id:c.env.TESLA_CLIENT_ID!,redirect_uri:uri,scope:'openid offline_access vehicle_device_data'+(s.requestedLocation?' vehicle_location':'')+(s.requestedCommands?' vehicle_cmds':''),state,prompt_missing_scopes:'true',require_requested_scopes:String(s.requestedCommands||s.requestedLocation)});
  return c.json({url:`https://auth.tesla.com/oauth2/v3/authorize?${q}`});
});
tesla.get('/callback',async c=>{
  const l=lease(c),s=l.data,state=c.req.query('state');
  if(!state||state.length>128||s.state!==await hash(state))throw new Failure('INVALID_STATE');
  const uri=callbackUri(c.env);if(new URL(c.req.url).origin!==new URL(uri).origin)throw new Failure('INVALID_STATE');
  await l.consumeState(state);delete s.state;await l.save();
  const code=c.req.query('code');if(c.req.query('error')||!code||code.length>4096)throw new Failure('AUTHORIZATION_DENIED');
  const data=await new TeslaClient(c.env,l).token({grant_type:'authorization_code',client_id:c.env.TESLA_CLIENT_ID!,client_secret:c.env.TESLA_CLIENT_SECRET!,redirect_uri:uri,audience:AUDIENCE,code});
  const t=acceptTokens(s,data);s.commands=!!s.requestedCommands&&hasScope(t,'vehicle_cmds');s.locationGranted=!!s.requestedLocation&&hasScope(t,'vehicle_location');
  delete s.requestedCommands;delete s.requestedLocation;s.vehicles={};delete s.selected;delete s.plan;s.csrf=nonce();
  const target=s.returnTo??'';delete s.returnTo;
  // Rotate browser identifier after authentication. New and old records are never
  // both authorized in a completed response; failures invalidate the old session.
  await l.remove();const id=await new Sessions(c.env).create(s);setSession(c,id);
  return c.redirect(new URL(target,c.env.FRONTEND_URL).href,303);
});
tesla.post('/disconnect',async c=>{await lease(c).remove();deleteCookie(c,cookie,{path:'/',secure:true});return c.body(null,204);});
tesla.post('/vehicles',async c=>{
  const l=lease(c),s=l.data;
  if(pending(s))throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  let raw:unknown;try{raw=await new TeslaClient(c.env,l).get('/api/1/vehicles');}catch(e){if(e instanceof Failure&&['NO_DATA','PERMISSION_DENIED','SERVICE_UNAVAILABLE','REQUEST_FAILED'].includes(e.code))throw new Failure(`VEHICLE_LIST_${({NO_DATA:'ENDPOINT_UNAVAILABLE',PERMISSION_DENIED:'PERMISSION_DENIED',SERVICE_UNAVAILABLE:'SERVICE_UNAVAILABLE',REQUEST_FAILED:'REQUEST_FAILED'} as Record<string,string>)[e.code]}`);throw e;}
  const parsed=z.array(vehicle).safeParse(payload(raw));if(!parsed.success)throw new Failure('INVALID_RESPONSE');
  s.vehicles={};delete s.selected;
  const list=parsed.data.map(v=>{const id=nonce();s.vehicles[id]=v.vin;return{id,name:v.display_name??'Tesla',state:v.state??'unknown'};});
  c.header('X-Flowad-Status',list.length?'VEHICLE_LIST_SUCCESS':'NO_ACCESSIBLE_VEHICLES');return c.json(list);
});
tesla.post('/select',async c=>{
  const s=lease(c).data,{id}=await body(c,z.object({id:z.string()}));if(pending(s))throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  if(!Object.hasOwn(s.vehicles,id))throw new Failure('INVALID_VEHICLE');s.selected=id;delete s.plan;return c.body(null,204);
});
tesla.post('/reading',async c=>{
  const l=lease(c),s=l.data,vin=s.vehicles[selected(s)];
  const data=charge.safeParse(payload(await new TeslaClient(c.env,l).get(`/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data_cached`)));
  if(!data.success)throw new Failure('INVALID_RESPONSE');const d=data.data.charge_state;
  if(!d)return c.json({status:'NO_DATA',batteryPercent:null,estimatedRangeKm:null,observedAt:null,stale:true,latitude:null,longitude:null,locationStatus:'NOT_REQUESTED'});
  const at=d.timestamp??null;
  return c.json({status:'CACHED',batteryPercent:d.battery_level??null,estimatedRangeKm:d.est_battery_range==null?null:round(d.est_battery_range*1.609344,1),observedAt:at,stale:at==null||Date.now()-at>900000,latitude:null,longitude:null,locationStatus:'NOT_AVAILABLE_IN_CACHED_DATA'});
});
tesla.post('/location',async c=>{
  const l=lease(c),s=l.data,vin=s.vehicles[selected(s)],client=new TeslaClient(c.env,l),base=`/api/1/vehicles/${encodeURIComponent(vin)}`;
  if(!s.locationGranted)throw new Failure('PERMISSION_DENIED');
  await client.access();if(!s.locationGranted)throw new Failure('PERMISSION_DENIED');
  const parsed=info.safeParse(payload(await client.get(base)));if(!parsed.success)throw new Failure('INVALID_RESPONSE');const v=parsed.data;
  if(v.granular_access?.hide_private)throw new Failure('PERMISSION_DENIED');if(v.state!=='online')throw new Failure('OFFLINE_OR_ASLEEP');
  const d=location.safeParse(payload(await client.get(base+'/vehicle_data?endpoints=location_data')));
  if(!d.success)throw new Failure('LOCATION_UNAVAILABLE');const p=d.data.drive_state,at=p.timestamp??null;
  return c.json({status:'LIVE',batteryPercent:null,estimatedRangeKm:null,observedAt:at,stale:at==null||Date.now()-at>900000,latitude:p.latitude,longitude:p.longitude,locationStatus:'AVAILABLE'});
});
function preview(c: Context,r:Route,text?:string){
  const s=lease(c).data,v=selected(s),seen=new Set<string>(),last=r.points.at(-1)!;seen.add(`${last.latitude},${last.longitude}`);
  const stops=r.points.slice(1).filter((p,i,a)=>{const key=`${p.latitude},${p.longitude}`;if(i===a.length-1)return true;if(seen.has(key))return false;seen.add(key);return true;}).map((p,i)=>({order:i+1,kind:p.type,name:p.name,latitude:p.latitude,longitude:p.longitude,navigationText:text??`${p.latitude},${p.longitude}`}));
  if(r.status!=='ROAD_ROUTED')throw new Failure('ROAD_ROUTE_REQUIRED');
  s.plan={id:crypto.randomUUID(),vehicle:v,expires:now()+300,stops,attempted:0,status:'NOT_SENT',vehicleStatus:'VEHICLE_NOT_CONFIRMED',pending:false,roadVerified:true};
  return {planId:s.plan.id,route:r,stops,mode:'SINGLE_DESTINATION',multiStopStatus:'UNSUPPORTED',status:'NOT_SENT',commandStatus:'COMMAND_NOT_SENT',expiresInSeconds:300,roadVerified:true,verificationStatus:'ROAD_ROUTE_VERIFIED'};
}
tesla.post('/navigation/preview',async c=>{
  const s=lease(c).data;if(!configured(c.env))throw new Failure('COMMAND_NOT_CONFIGURED');if(pending(s))return c.json(outcome(s.plan!));
  const input=await body(c,z.union([selectedRequest,vehicleConditions.extend({courseId:z.string(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),returnLatitude:z.number().min(-90).max(90).optional(),returnLongitude:z.number().min(-180).max(180).optional()}).refine(v=>(v.returnLatitude===undefined)===(v.returnLongitude===undefined))]));selected(s);
  // A failed new verification invalidates a previously prepared, unsent plan.
  delete s.plan;
  const verified='ticket'in input?await verifySelected(input,c.env):await verifySelection(input.courseId,input.latitude,input.longitude,input.returnLatitude??input.latitude,input.returnLongitude??input.longitude,input,c.env);
  return c.json({...preview(c,verified.route),batteryStatus:verified.batteryStatus,withinAvailableMinutes:verified.withinAvailableMinutes,navigationTicket:verified.navigationTicket,note:verified.note});
});
tesla.post('/navigation/destination/preview',async c=>{
  const s=lease(c).data;if(!configured(c.env))throw new Failure('COMMAND_NOT_CONFIGURED');if(pending(s))return c.json(outcome(s.plan!));
  const input=await body(c,coordinate.extend({name:z.string().trim().min(1).max(120),address:z.string().trim().min(1).max(300),originLatitude:z.number().min(-90).max(90),originLongitude:z.number().min(-180).max(180)}));selected(s);
  delete s.plan;
  return c.json(preview(c,await destination(input.name,input.latitude,input.longitude,input.originLatitude,input.originLongitude,c.env),`${input.name}, ${input.address}`));
});
tesla.post('/navigation/send',async c=>{
  const l=lease(c),s=l.data,input=await body(c,z.object({planId:z.string(),order:z.number().int(),replaceDestination:z.boolean()})),p=s.plan;
  if(!p||p.id!==input.planId||p.expires<now()||p.vehicle!==selected(s))throw new Failure('PLAN_EXPIRED');
  if(p.status!=='NOT_SENT')throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  if(p.roadVerified!==true)throw new Failure('ROAD_VERIFICATION_REQUIRED');
  if(!input.replaceDestination)throw new Failure(p.stops.length>1?'MULTI_STOP_UNSUPPORTED':'DESTINATION_REPLACEMENT_NOT_CONFIRMED');
  if(input.order<1||input.order>p.stops.length)throw new Failure('INVALID_DESTINATION');
  p.attempted=input.order;p.status='SENDING';p.pending=true;p.error='COMMAND_RESULT_UNKNOWN';
  // Persist the attempt before any external effect. Crash recovery blocks resends.
  await l.save();
  try{
    if(!s.commands)throw new Failure('COMMAND_PERMISSION_REQUIRED');const client=new TeslaClient(c.env,l);await client.access();if(!s.commands)throw new Failure('COMMAND_PERMISSION_REQUIRED');
    const base=`/api/1/vehicles/${encodeURIComponent(s.vehicles[selected(s)])}`;
    const parsed=info.safeParse(payload(await client.get(base)));if(!parsed.success)throw new Failure('INVALID_RESPONSE');const v=parsed.data;if(v.state!=='online')throw new Failure('OFFLINE_OR_ASLEEP');
    const stop=p.stops[input.order-1];
    const raw=await client.command(base+'/command/navigation_request',{type:'share_ext_content_raw',value:{'android.intent.extra.TEXT':stop.navigationText},locale:'ko-KR',timestamp_ms:String(Date.now())});
    const accepted=z.object({response:z.object({result:z.boolean()})}).safeParse(raw);
    if(!accepted.success)throw new Failure('COMMAND_RESULT_UNKNOWN');
    p.status=accepted.data.response.result?'API_ACCEPTED':'API_FAILED';p.pending=accepted.data.response.result;
    if(p.pending)delete p.error;else p.error='COMMAND_REJECTED';
  }catch(e){p.status='API_FAILED';p.error=e instanceof Failure?e.code:'COMMAND_RESULT_UNKNOWN';p.pending=['COMMAND_TIMEOUT','COMMAND_RESULT_UNKNOWN'].includes(p.error);}
  return c.json(outcome(p));
});
tesla.post('/navigation/confirm',async c=>{
  const p=lease(c).data.plan,input=await body(c,z.object({planId:z.string(),order:z.number().int(),matched:z.boolean()}));
  if(!p||p.id!==input.planId||p.attempted!==input.order||!p.pending)throw new Failure('NO_PENDING_COMMAND');
  p.pending=false;if(input.matched)p.vehicleStatus='VEHICLE_CONFIRMED';return c.json(outcome(p));
});
