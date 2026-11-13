import { describe,it,expect,vi } from 'vitest';
import { authenticated,call,config,external,json } from './helpers';
import { Sessions,cleanup } from '../src/repository';
import { hash,now } from '../src/utils';
import { AUDIENCE,TOKEN } from '../src/tesla-client';
const oauth=()=>config({TESLA_CLIENT_ID:'mock-client',TESLA_CLIENT_SECRET:'mock-secret',TESLA_REDIRECT_URI:'https://flowad.test/api/tesla/callback',FRONTEND_URL:'https://flowad.test/'});
const token={access_token:'mock-access',refresh_token:'mock-refresh',expires_in:3600,scope:'openid offline_access vehicle_device_data vehicle_location vehicle_cmds'};
async function login(){const a=await authenticated({tokens:undefined},oauth());const r=await a.post('authorize?location=true&commands=true&returnTo=check');const d=await r.json() as {url:string};return{...a,state:new URL(d.url).searchParams.get('state')!,url:d.url};}
describe('Tesla OAuth and Fleet mock-only',()=>{
  it('returns legacy status, secure host cookie and safe unsupported HTTP status',async()=>{
    const r=await call('/api/tesla/status');expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('__Host-flowad=');expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('SameSite=Lax');expect(await r.json()).toMatchObject({connection:'NOT_CONNECTED',secure:true});
    const plain=await call('/api/tesla/status',undefined,{url:'http://localhost'});expect((await plain.json() as {secure:boolean}).secure).toBe(false);expect(plain.headers.get('set-cookie')).toBeNull();
  });
  it('requires HTTPS and session CSRF, including unauthenticated requests',async()=>{
    expect((await call('/api/tesla/vehicles',{})).status).toBe(403);
    const a=await authenticated();expect((await call('/api/tesla/vehicles',{}, {headers:{Cookie:a.headers.Cookie},env:a.env})).status).toBe(403);
    expect((await call('/api/tesla/vehicles',{}, {headers:a.headers,env:a.env,url:'http://localhost'})).status).toBe(403);
  });
  it('generates random state, binds session and exact callback, exchanges once and rotates cookie',async()=>{
    const a=await login();expect(a.state).toMatch(/^[\w-]{43}$/);expect(a.url).toContain('vehicle_location');expect(a.url).toContain('vehicle_cmds');
    const fn=external((url,init)=>{expect(url).toBe(TOKEN);const form=new URLSearchParams(String(init?.body));expect(form.get('client_secret')).toBe('mock-secret');expect(form.get('audience')).toBe(AUDIENCE);return json(token);});
    const callback=()=>call('/api/tesla/callback?state='+a.state+'&code=mock-code',undefined,{headers:a.headers,env:a.env});
    const r=await callback();expect(r.status).toBe(303);expect(r.headers.get('Location')).toBe('https://flowad.test/tesla-check.html');expect(r.headers.get('Set-Cookie')).not.toContain(a.id);expect(fn).toHaveBeenCalledTimes(1);
    expect((await callback()).status).toBe(400);expect(fn).toHaveBeenCalledTimes(1);
    const status=await call('/api/tesla/status',undefined,{headers:{Cookie:r.headers.get('Set-Cookie')!.split(';')[0]},env:a.env});expect(await status.json()).toMatchObject({connection:'CONNECTED',oauthStatus:'OAUTH_CONNECTED'});
  });
  it('rejects state in another browser, expires state, and cannot replay a denied authorization',async()=>{
    const a=await login(),other=await authenticated({tokens:undefined},a.env);
    expect((await call('/api/tesla/callback?state='+a.state+'&code=x',undefined,{headers:other.headers,env:a.env})).status).toBe(400);
    await a.env.DB.prepare('UPDATE oauth_states SET expires_at=?').bind(now()-1).run();
    expect((await call('/api/tesla/callback?state='+a.state+'&code=x',undefined,{headers:a.headers,env:a.env})).status).toBe(400);
    const b=await login();expect((await call('/api/tesla/callback?state='+b.state+'&error=access_denied',undefined,{headers:b.headers,env:b.env})).status).toBe(400);
    expect((await call('/api/tesla/callback?state='+b.state+'&code=x',undefined,{headers:b.headers,env:b.env})).status).toBe(400);
  });
  it('atomically allows only one state consumer and one session lease',async()=>{
    const a=await authenticated(),repo=new Sessions(a.env),l=await repo.open(a.id);await l.state('one-state');
    const consumed=await Promise.allSettled([l.consumeState('one-state'),l.consumeState('one-state')]);expect(consumed.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    await expect(repo.open(a.id)).rejects.toMatchObject({code:'SESSION_BUSY'});await l.save(true);const next=await repo.open(a.id);await next.save(true);
  });
  it('encrypts tokens, VINs and CSRF in D1; expires and removes sessions',async()=>{
    const a=await authenticated();const row=await a.env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(await hash(a.id)).first();const raw=JSON.stringify(row);expect(raw).not.toContain('test-access');expect(raw).not.toContain('TEST-VIN');expect(raw).not.toContain('test-csrf');expect(raw).not.toContain(a.id);
    await a.env.DB.prepare('UPDATE sessions SET expires_at=?').bind(now()-1).run();await expect(new Sessions(a.env).open(a.id)).rejects.toMatchObject({code:'NOT_CONNECTED'});await cleanup(a.env);expect(await a.env.DB.prepare('SELECT id FROM sessions').first()).toBeNull();
  });
  it('rejects missing setup and invalid callbacks without outbound calls',async()=>{
    const a=await authenticated();expect(await(await a.post('authorize')).json()).toEqual({error:'NOT_CONFIGURED'});
    for(const uri of ['http://flowad.test/api/tesla/callback','https://flowad.test/wrong','https://user@flowad.test/api/tesla/callback']){const b=await authenticated({},config({...oauth(),TESLA_REDIRECT_URI:uri}));expect((await b.post('authorize')).status).toBe(503);}
  });
  it('accepts callbacks only on the exact registered HTTPS origin and path',async()=>{const a=await authenticated({},config({...oauth(),API_PREFIX:'/flowad',TESLA_REDIRECT_URI:'https://flowad.test/flowad/api/tesla/callback'}));expect((await call('/api/tesla/callback?state=x',undefined,{headers:a.headers,env:a.env})).status).toBe(400);expect((await call('/flowad/api/tesla/callback?state=x',undefined,{headers:a.headers,env:a.env,url:'https://wrong.test'})).status).toBe(400);});
  it('keeps an empty list and exposes NO_ACCESSIBLE_VEHICLES without inventing a car',async()=>{const a=await authenticated();external(()=>json({response:[]}));const r=await a.post('vehicles');expect(await r.json()).toEqual([]);expect(r.headers.get('X-Flowad-Status')).toBe('NO_ACCESSIBLE_VEHICLES');expect((await a.post('select',{id:'fake'})).status).toBe(400);});
  it('returns opaque vehicle IDs, checks ownership and parses battery cache',async()=>{
    const a=await authenticated();const fn=external(url=>json(url.endsWith('/vehicles')?{response:[{vin:'private-vin',display_name:'Test Tesla',state:'online'}]}:{response:{charge_state:{battery_level:70,est_battery_range:100,timestamp:Date.now()}}}));
    const list=await a.post('vehicles');const cars=await list.json() as {id:string;name:string}[];expect(JSON.stringify(cars)).not.toContain('private-vin');expect(list.headers.get('X-Flowad-Status')).toBe('VEHICLE_LIST_SUCCESS');
    expect((await a.post('select',{id:cars[0].id})).status).toBe(204);const r=await a.post('reading');expect(await r.json()).toMatchObject({status:'CACHED',batteryPercent:70,estimatedRangeKm:160.9,stale:false,latitude:null});expect(fn.mock.calls.at(-1)?.[0]).toContain('/private-vin/vehicle_data_cached');
    expect(await(await a.post('select',{id:'toString'})).json()).toEqual({error:'INVALID_VEHICLE'});
  });
  it('serializes single-use token rotation, persists new refresh and does not reuse an uncertain refresh',async()=>{
    const a=await authenticated({tokens:{access:'expired',refresh:'single-use',expires:now()-1}},oauth());let refreshes=0;
    external((url,init)=>{if(url===TOKEN){refreshes++;expect(String(init?.body)).toContain('single-use');return json(token);}expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer mock-access');return json({response:[]});});
    expect((await a.post('vehicles')).status).toBe(200);expect((await a.post('vehicles')).status).toBe(200);expect(refreshes).toBe(1);
    const l=await new Sessions(a.env).open(a.id);expect(l.data.tokens?.refresh).toBe('mock-refresh');await l.save(true);
    const b=await authenticated({tokens:{access:'expired',refresh:'do-not-retry',expires:now()-1}},oauth());const fn=external(()=>{throw new Error('network lost');});
    expect(await(await b.post('vehicles')).json()).toEqual({error:'REAUTH_REQUIRED'});await b.post('vehicles');expect(fn).toHaveBeenCalledTimes(1);
  });
  it.each([[401,'REAUTH_REQUIRED'],[403,'VEHICLE_LIST_PERMISSION_DENIED'],[404,'VEHICLE_LIST_ENDPOINT_UNAVAILABLE'],[412,'PRECONDITION_FAILED'],[402,'PAYMENT_REQUIRED'],[421,'INCORRECT_REGION'],[429,'VEHICLE_LIST_SERVICE_UNAVAILABLE'],[500,'VEHICLE_LIST_SERVICE_UNAVAILABLE']])('keeps Tesla HTTP %i error classification',async(status,code)=>{const a=await authenticated();external(()=>json({},Number(status)));const r=await a.post('vehicles');expect(r.status).toBe(400);expect(await r.json()).toEqual({error:code});});
  it('rejects malformed vehicle/token responses without returning upstream bodies',async()=>{const a=await authenticated();external(()=>json({response:[{secret:'do-not-return'}]}));const r=await a.post('vehicles');expect(await r.json()).toEqual({error:'INVALID_RESPONSE'});const b=await login();external(()=>json({access_token:'secret'}));const cb=await call('/api/tesla/callback?state='+b.state+'&code=x',undefined,{headers:b.headers,env:b.env});expect(await cb.json()).toEqual({error:'TOKEN_RESPONSE_INVALID'});});
  it('does not wake sleeping vehicles or request location without scope',async()=>{const a=await authenticated();const fn=external(()=>json({response:{state:'asleep'}}));expect(await(await a.post('location')).json()).toEqual({error:'OFFLINE_OR_ASLEEP'});expect(fn).toHaveBeenCalledTimes(1);const b=await authenticated({locationGranted:false});expect(await(await b.post('location')).json()).toEqual({error:'PERMISSION_DENIED'});expect(fn).toHaveBeenCalledTimes(1);});
  it('parses live location only after online and privacy checks',async()=>{const a=await authenticated();external(url=>json({response:url.endsWith('location_data')?{drive_state:{latitude:37.5,longitude:127,timestamp:Date.now()}}:{state:'online'}}));expect(await(await a.post('location')).json()).toMatchObject({status:'LIVE',latitude:37.5,longitude:127,locationStatus:'AVAILABLE',stale:false});});
  it('maps abortable upstream timeout and never retries',async()=>{
    const a=await authenticated();vi.useFakeTimers();try{const fn=external((_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')));}));const pending=a.post('vehicles');await vi.advanceTimersByTimeAsync(11000);const r=await pending;expect(await r.json()).toEqual({error:'VEHICLE_LIST_SERVICE_UNAVAILABLE'});expect(fn).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}
  });
  it('disconnects and invalidates user access',async()=>{const a=await authenticated();expect((await a.post('disconnect')).status).toBe(204);expect(await a.env.DB.prepare('SELECT id FROM sessions WHERE id=?').bind(await hash(a.id)).first()).toBeNull();expect((await a.post('reading')).status).toBe(400);});
});

describe('navigation commands: mocked side effects only',()=>{
  async function planned(){const a=await authenticated({},oauth());const l=await new Sessions(a.env).open(a.id);l.data.plan={id:'plan',vehicle:'car',expires:now()+300,stops:[{order:1,kind:'DESTINATION',name:'Public test destination',latitude:37,longitude:127,navigationText:'37,127'}],attempted:0,status:'NOT_SENT',vehicleStatus:'VEHICLE_NOT_CONFIRMED',pending:false,roadVerified:true};await l.save(true);return a;}
  it('rejects an existing plan without road-verification proof before any vehicle API',async()=>{const a=await planned(),l=await new Sessions(a.env).open(a.id);delete l.data.plan!.roadVerified;await l.save(true);const fn=external(()=>json({}));expect(await(await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:true})).json()).toEqual({error:'ROAD_VERIFICATION_REQUIRED'});expect(fn).not.toHaveBeenCalled();});
  it('requires road-routed preview and never sends during preview',async()=>{const a=await authenticated({},oauth());const r=await a.post('navigation/preview',{courseId:'yangpyeong',latitude:37.5665,longitude:126.978});expect(await r.json()).toEqual({error:'ROAD_ROUTE_REQUIRED'});});
  it('preserves successful destination and course preview contracts without sending a vehicle command',async()=>{
    const a=await authenticated({},config({...oauth(),ROAD_ROUTING_URL:'https://roads.test'}));
    const fn=external(url=>{expect(new URL(url).origin).toBe('https://roads.test');const coords=new URL(url).pathname.split('/').at(-1)!.split(';').map(s=>s.split(',').map(Number));return json({code:'Ok',waypoints:coords.map(location=>({location,distance:0})),routes:[{legs:coords.slice(1).map((b,i)=>({distance:1000,duration:60,steps:[{geometry:{coordinates:[coords[i],b]}}]}))}]});});
    const r=await a.post('navigation/destination/preview',{name:'Public destination',address:'Public street',latitude:37,longitude:127,originLatitude:38,originLongitude:128});
    expect(r.status).toBe(200);expect(await r.json()).toMatchObject({mode:'SINGLE_DESTINATION',multiStopStatus:'UNSUPPORTED',status:'NOT_SENT',expiresInSeconds:300,route:{status:'ROAD_ROUTED'},stops:[{order:1,kind:'DESTINATION',navigationText:'Public destination, Public street'}]});
    const course=await a.post('navigation/preview',{courseId:'yangpyeong',latitude:37.5665,longitude:126.978});const p=await course.json() as {stops:{kind:string}[]};expect(course.status).toBe(200);expect(p.stops).toHaveLength(4);expect(p.stops.at(-1)?.kind).toBe('RETURN');expect(fn).toHaveBeenCalledTimes(2);
  });
  it('requires replacement approval, persists one attempt, separates API acceptance and user confirmation',async()=>{
    const a=await planned();expect(await(await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:false})).json()).toEqual({error:'DESTINATION_REPLACEMENT_NOT_CONFIRMED'});
    let commands=0;external((url,init)=>{if(url.endsWith('navigation_request')){commands++;const body=JSON.parse(String(init?.body));expect(body).toMatchObject({type:'share_ext_content_raw',value:{'android.intent.extra.TEXT':'37,127'}});return json({response:{result:true}});}return json({response:{state:'online'}});});
    const r=await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:true});expect(await r.json()).toMatchObject({status:'API_ACCEPTED',commandStatus:'COMMAND_SENT',navigationStatus:'NAVIGATION_NOT_CONFIRMED',automaticallyVerified:false,requiresVehicleCheck:true});
    expect(await(await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:true})).json()).toEqual({error:'DUPLICATE_OR_UNCONFIRMED_COMMAND'});expect(commands).toBe(1);
    expect(await(await a.post('vehicles')).json()).toEqual({error:'DUPLICATE_OR_UNCONFIRMED_COMMAND'});
    const confirmed=await a.post('navigation/confirm',{planId:'plan',order:1,matched:true});expect(await confirmed.json()).toMatchObject({navigationStatus:'NAVIGATION_CONFIRMED',confirmationSource:'USER_REPORTED',automaticallyVerified:false});
  });
  it('keeps uncertain command result pending across requests, preventing a second send or new preview',async()=>{
    const a=await planned();const fn=external(url=>{if(url.endsWith('navigation_request'))throw new Error('network lost');return json({response:{state:'online'}});});
    const r=await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:true});expect(await r.json()).toMatchObject({status:'API_FAILED',error:'COMMAND_RESULT_UNKNOWN',requiresVehicleCheck:true});
    const preview=await a.post('navigation/preview',{});expect(await preview.json()).toMatchObject({planId:'plan',requiresVehicleCheck:true});await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:true});expect(fn).toHaveBeenCalledTimes(2);
  });
  it('recovers a crash after persisted SENDING as an unresolved command',async()=>{const a=await planned(),l=await new Sessions(a.env).open(a.id);Object.assign(l.data.plan!,{status:'SENDING',pending:true,attempted:1});await l.save(true);expect(await(await a.post('navigation/send',{planId:'plan',order:1,replaceDestination:true})).json()).toEqual({error:'DUPLICATE_OR_UNCONFIRMED_COMMAND'});});
});
