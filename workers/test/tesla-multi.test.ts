import {it,expect,vi} from 'vitest';
import {authenticated,config,external,json,call} from './helpers';
import {point,finish} from '../src/routing';
import {issue,resolve} from '../src/tickets';
import {Sessions} from '../src/repository';
import {now,Failure} from '../src/utils';
import {orderedNavigationStops,maxNavigationStops,multiCapabilities,navigationAdapters,dispatchNavigation,requireMultiSend} from '../src/tesla-navigation';
import {TeslaClient} from '../src/tesla-client';
const options={TESLA_CLIENT_ID:'mock-id',TESLA_CLIENT_SECRET:'mock-secret',TESLA_REDIRECT_URI:'https://flowad.test/api/tesla/callback',TESLA_MULTI_STOP_MODE:'dry-run'};
const e=()=>config(options);
function itinerary(roundTrip=true){
 const points=[point(0,'ORIGIN','합성 출발',35.18,129.07),point(1,'SCENIC_WAYPOINT','합성 풍경 1',35.2,129.2),point(2,'SCENIC_WAYPOINT','합성 풍경 2',35.22,129.21),point(3,'SCENIC_WAYPOINT','합성 풍경 1 재방문',35.2,129.2),point(4,'DESTINATION','합성 목적지',35.26,129.23)];
 if(roundTrip)points.push(point(5,'RETURN','합성 복귀',35.18,129.07));return points;
}
async function ticket(env=e(),roundTrip=true,status='ROAD_ROUTED'){
 const points=itinerary(roundTrip).map(p=>({...p,googlePlace:{id:"SyntheticID"+Math.round(p.latitude*100),source:"GOOGLE_PLACES" as const,verifiedAt:new Date().toISOString(),identityConfirmed:true as const,location:{latitude:p.latitude,longitude:p.longitude},matchedPoint:{latitude:p.latitude,longitude:p.longitude,name:p.name}}})),legs=points.slice(1).map((_,i)=>({fromOrder:i,toOrder:i+1,distanceKm:1,durationSeconds:60,geometry:null}));
 return issue('dyn-synthetic-multi',finish(points,{legs,status,provider:'SYNTHETIC TEST ONLY',geometryStatus:'NOT_AVAILABLE'},0,'UNAVAILABLE',[]),env.NAVIGATION_TICKET_SECRET);
}
async function prepared(){const env=e(),a=await authenticated({},env),t=await ticket(env),r=await a.post('navigation/multi/preview',{ticket:t});expect(r.status).toBe(200);return {...a,t,plan:await r.json() as {planId:string;stops:unknown[]}};}
it.each([true,false])('keeps every signed visit, repeated coordinates and return (%s)',async roundTrip=>{
 const env=e(),provider=external(()=>{throw Error('No vehicle or road HTTP allowed');}),a=await authenticated({},env);
 const r=await a.post('navigation/multi/preview',{ticket:await ticket(env,roundTrip),strategy:'WAYPOINTS'});
 expect(r.status).toBe(200);const p=await r.json() as {stops:Array<{kind:string;order:number;latitude:number;longitude:number}>};
 expect(p).toMatchObject({status:'PREVIEW_READY',commandStatus:'COMMAND_NOT_SENT',roundTrip,vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'});
 expect(p.stops).toMatchObject(itinerary(roundTrip).slice(1).map(p=>({order:p.order,kind:p.type,name:p.name,latitude:p.latitude,longitude:p.longitude})));
 expect(p.stops[0].latitude).toBe(p.stops[2].latitude);expect(p.stops.at(-1)?.kind).toBe(roundTrip?'RETURN':'DESTINATION');expect(provider).not.toHaveBeenCalled();
});
it.each(['WAYPOINTS','GPS_ORDERED'] as const)('dry-runs %s without inventing a Tesla wire request',async strategy=>{
 const env=e(),a=await authenticated({},env),provider=external(()=>{throw Error('unexpected HTTP');});
 const p=await(await a.post('navigation/multi/preview',{ticket:await ticket(env),strategy})).json() as {planId:string};
 const r=await a.post('navigation/multi/dry-run',{planId:p.planId});expect(r.status).toBe(200);
 expect(await r.json()).toMatchObject({status:'DRY_RUN_VALIDATED',scope:'SIGNED_ITINERARY_AND_WIRE_PLAN',schemaValidated:true,commandCount:strategy==='WAYPOINTS'?1:5,commandStatus:'COMMAND_NOT_SENT',canSend:false,strategy});
 expect(provider).not.toHaveBeenCalled();
});
it('reports known API/SDK support separately from the unknown installed proxy and vehicle',()=>{
 const caps=multiCapabilities(e());expect(caps.liveSendEnabled).toBe(false);expect(caps.limits.teslaMaxStops).toBeNull();expect(caps.installedProxyVersion).toBe('NOT_VERIFIED');expect(caps.methods.every(m=>m.endpointDocumented&&!m.canSend&&m.schemaStatus==='REQUIRED_FIELDS_CONFIRMED'&&m.proxySupport==='UNSUPPORTED_AT_SDK_PIN')).toBe(true);
 expect(multiCapabilities(config()).featureEnabled).toBe(false);
});
it('limits the Flowad manifest without truncation and rejects invalid visit order',()=>{
 const many=Array.from({length:maxNavigationStops+2},(_,i)=>point(i,i===0?'ORIGIN':i===maxNavigationStops+1?'DESTINATION':'SCENIC_WAYPOINT','fixture '+i,35+i*.001,129));
 expect(()=>orderedNavigationStops(many)).toThrow('WAYPOINT_LIMIT_EXCEEDED');
 const bad=itinerary();[bad[1],bad[2]]=[bad[2],bad[1]];expect(()=>orderedNavigationStops(bad)).toThrow('INVALID_NAVIGATION_ITINERARY');
 const afterDestination=itinerary();afterDestination[2].type='DESTINATION';expect(()=>orderedNavigationStops(afterDestination)).toThrow('INVALID_NAVIGATION_ITINERARY');
 const invalid=itinerary();invalid[1].latitude=NaN;expect(()=>orderedNavigationStops(invalid)).toThrow('INVALID_NAVIGATION_ITINERARY');
});
it.each([
 [{tokens:undefined},'NOT_CONNECTED'],[{selected:undefined},'NO_VEHICLE_SELECTED'],[{commands:false},'COMMAND_PERMISSION_REQUIRED']
] as const)('checks cached ownership and command permission before dry-run: %s',async(extra,error)=>{
 const env=e(),a=await authenticated(extra,env),provider=external(()=>{throw Error('unexpected HTTP');});
 const r=await a.post('navigation/multi/preview',{ticket:await ticket(env)});expect(await r.json()).toMatchObject({error,commandStatus:'COMMAND_NOT_SENT'});expect(provider).not.toHaveBeenCalled();
});
it('retains CSRF/HTTPS protection and is disabled when the feature flag is absent',async()=>{
 const a=await authenticated({},e()),t=await ticket(a.env),provider=external(()=>json({}));
 expect((await call('/api/tesla/navigation/multi/preview',{ticket:t},{env:a.env,headers:{Cookie:a.headers.Cookie}})).status).toBe(403);
 expect((await call('/api/tesla/navigation/multi/preview',{ticket:t},{env:a.env,headers:a.headers,url:'http://localhost'})).status).toBe(403);
 const off=await authenticated({},config({...options,TESLA_MULTI_STOP_MODE:undefined}));
 expect(await(await off.post('navigation/multi/preview',{ticket:t})).json()).toMatchObject({error:'MULTI_STOP_FEATURE_DISABLED',commandStatus:'COMMAND_NOT_SENT'});expect(provider).not.toHaveBeenCalled();
});
it('rejects estimates, altered tickets and client-supplied replacement stops',async()=>{
 const a=await authenticated({},e()),provider=external(()=>json({})),t=await ticket(a.env);
 for(const [input,error] of [[{ticket:await ticket(a.env,true,'ESTIMATED_NOT_ROAD_ROUTED')},'ROAD_VERIFICATION_REQUIRED'],[{ticket:t+'altered'},'INVALID_TICKET'],[{ticket:t,stops:[{name:'replacement'}]},'INVALID_REQUEST']] as const){
  expect(await(await a.post('navigation/multi/preview',input)).json()).toMatchObject({error,commandStatus:'COMMAND_NOT_SENT'});
 }
 expect(provider).not.toHaveBeenCalled();
});
it('expires signed road proof and does not extend its lifetime during dry-run',async()=>{
 const a=await prepared(),proof=await resolve(a.t,a.env.NAVIGATION_TICKET_SECRET);
 await a.post('navigation/multi/dry-run',{planId:a.plan.planId});const l=await new Sessions(a.env).open(a.id);expect(l.data.plan!.expires).toBeLessThanOrEqual(proof.expiresAt);await l.save(true);
 vi.useFakeTimers();try{vi.setSystemTime(new Date((proof.expiresAt+1)*1000));expect(await(await a.post('navigation/multi/preview',{ticket:a.t})).json()).toMatchObject({error:'TICKET_EXPIRED',commandStatus:'COMMAND_NOT_SENT'});}finally{vi.useRealTimers();}
});
it('keeps disabled and unknown-schema commands blocked even when the live flag is true',async()=>{
 const a=await prepared(),provider=external(()=>{throw Error('No HTTP allowed');}),input={planId:a.plan.planId,confirmAllStops:true,replaceNavigation:true};
 expect(await(await a.post('navigation/multi/send',input)).json()).toMatchObject({error:'DRY_RUN_REQUIRED',commandStatus:'COMMAND_NOT_SENT'});
 await a.post('navigation/multi/dry-run',{planId:a.plan.planId});
 expect(await(await a.post('navigation/multi/send',input)).json()).toMatchObject({error:'MULTI_STOP_SEND_DISABLED',commandStatus:'COMMAND_NOT_SENT'});
 const live={...a.env,TESLA_MULTI_STOP_SEND_ENABLED:'true'};
 expect(await(await call('/api/tesla/navigation/multi/send',input,{env:live,headers:a.headers})).json()).toMatchObject({error:'MULTI_STOP_SEND_DISABLED',commandStatus:'COMMAND_NOT_SENT'});
 for(const strategy of ['WAYPOINTS','GPS_ORDERED'] as const){expect(()=>navigationAdapters[strategy].serialize([])).toThrow('WAYPOINT_LIMIT_EXCEEDED');expect(()=>requireMultiSend(live,strategy,orderedNavigationStops(itinerary()))).toThrow('MULTI_STOP_SEND_DISABLED');}
 expect(provider).not.toHaveBeenCalled();
});
it('prevents cross-mode sends, vehicle changes and forged plan IDs',async()=>{
 const a=await prepared(),provider=external(()=>json({}));
 expect(await(await a.post('navigation/send',{planId:a.plan.planId,order:1,replaceDestination:true})).json()).toEqual({error:'WRONG_NAVIGATION_MODE'});
 expect(await(await a.post('navigation/multi/dry-run',{planId:crypto.randomUUID()})).json()).toMatchObject({error:'PLAN_EXPIRED'});
 const l=await new Sessions(a.env).open(a.id);l.data.vehicles.other='OTHER-MOCK-VIN';l.data.selected='other';await l.save(true);
 expect(await(await a.post('navigation/multi/dry-run',{planId:a.plan.planId})).json()).toMatchObject({error:'PLAN_EXPIRED'});expect(provider).not.toHaveBeenCalled();
});
it('does not confirm a partial itinerary as a full route, including after proof expiry',async()=>{
 const a=await prepared(),l=await new Sessions(a.env).open(a.id),p=l.data.plan!;
 p.status='API_FAILED';p.pending=true;p.error='PARTIAL_COMMAND_ACCEPTANCE';p.expires=now()-1;p.multi!.attemptedCommands=1;p.multi!.acceptedCommands=1;p.multi!.totalCommands=2;await l.save(true);
 const same=await a.post('navigation/multi/preview',{ticket:a.t});expect(await same.json()).toMatchObject({planId:a.plan.planId,requiresVehicleCheck:true});
 expect(await(await a.post('navigation/multi/send',{planId:a.plan.planId,confirmAllStops:true,replaceNavigation:true})).json()).toMatchObject({error:'PLAN_EXPIRED',requiresVehicleCheck:true});
 expect(await(await a.post('navigation/multi/confirm',{planId:a.plan.planId,matched:true,confirmedStopCount:a.plan.stops.length,confirmedVisitOrder:true})).json()).toMatchObject({error:'INCOMPLETE_ROUTE_CONFIRMATION',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'});
 expect(await(await a.post('navigation/multi/confirm',{planId:a.plan.planId,matched:false,confirmedStopCount:0,confirmedVisitOrder:false})).json()).toMatchObject({requiresVehicleCheck:false,vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'});
});
it('distinguishes API acceptance from user-reported confirmation of every stop',async()=>{
 const a=await prepared(),l=await new Sessions(a.env).open(a.id),p=l.data.plan!;
 p.status='API_ACCEPTED';p.pending=true;p.multi!.attemptedCommands=1;p.multi!.acceptedCommands=1;p.multi!.totalCommands=1;await l.save(true);
 const before=await(await a.post('navigation/multi/preview',{ticket:a.t})).json();expect(before).toMatchObject({commandStatus:'COMMAND_API_ACCEPTED',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'});
 expect(await(await a.post('navigation/multi/confirm',{planId:a.plan.planId,matched:true,confirmedStopCount:a.plan.stops.length,confirmedVisitOrder:true})).json()).toMatchObject({vehicleNavigationStatus:'VEHICLE_NAVIGATION_CONFIRMED',confirmationSource:'USER_REPORTED',automaticallyVerified:false});
});
it('checkpoints each attempt before its mocked effect and never treats malformed 200 as acceptance',async()=>{
 const events:string[]=[],effects=[vi.fn(async()=>{events.push('effect');return {response:{result:true}};}),vi.fn(async()=>({response:{}})),vi.fn()];
 const result=await dispatchNavigation(effects,async p=>{events.push('save-'+p.attemptedCommands);});
 expect(events.slice(0,2)).toEqual(['save-1','effect']);expect(result).toMatchObject({status:'API_FAILED',acceptedCommands:1,attemptedCommands:2,pending:true,error:'COMMAND_RESULT_UNKNOWN'});expect(effects[2]).not.toHaveBeenCalled();
});
it.each([new Error('proxy disconnected'),new Failure('COMMAND_TIMEOUT'),new Failure('COMMAND_RESULT_UNKNOWN')])('stops without retry on unknown proxy/Tesla results: %s',async error=>{
 const command=vi.fn(async()=>{throw error;}),next=vi.fn();const result=await dispatchNavigation([command,next],async()=>{});
 expect(result).toMatchObject({pending:true,error:'COMMAND_RESULT_UNKNOWN',attemptedCommands:1,acceptedCommands:0});expect(command).toHaveBeenCalledOnce();expect(next).not.toHaveBeenCalled();
});
it('blocks the first effect if persisting the attempt fails',async()=>{
 const command=vi.fn();await expect(dispatchNavigation([command],async()=>{throw Error('storage unavailable');})).rejects.toThrow();expect(command).not.toHaveBeenCalled();
});
it.each([['invalid_command','UNSUPPORTED_COMMAND'],['Tesla Vehicle Command Protocol required, please refer to the documentation','COMMAND_PROTOCOL_REQUIRED']] as const)('classifies a known unsupported command response without forwarding its text',async(error,code)=>{
 const a=await authenticated({},e()),l=await new Sessions(a.env).open(a.id),provider=external(()=>json({response:null,error},400));
 await expect(new TeslaClient(a.env,l).command('/api/1/vehicles/TEST-VIN/command/navigation_request',{})).rejects.toMatchObject({code});expect(provider).toHaveBeenCalledOnce();await l.save(true);
});
it('records partial rejection and API-only acceptance separately',async()=>{
 const accepted=()=>Promise.resolve({response:{result:true}}),rejected=()=>Promise.resolve({response:{result:false}}),next=vi.fn();
 expect(await dispatchNavigation([accepted,rejected,next],async()=>{})).toMatchObject({status:'API_FAILED',error:'PARTIAL_COMMAND_ACCEPTANCE',acceptedCommands:1,attemptedCommands:2,pending:true});expect(next).not.toHaveBeenCalled();
 expect(await dispatchNavigation([accepted,accepted],async()=>{})).toMatchObject({status:'API_ACCEPTED',acceptedCommands:2,pending:true});
 expect(await dispatchNavigation([rejected],async()=>{})).toMatchObject({status:'API_FAILED',error:'COMMAND_REJECTED',pending:false});
});
it.each([[400,'REQUEST_FAILED'],[401,'REAUTH_REQUIRED'],[403,'PERMISSION_DENIED'],[404,'NO_DATA'],[408,'COMMAND_RESULT_UNKNOWN'],[429,'COMMAND_RESULT_UNKNOWN'],[500,'COMMAND_RESULT_UNKNOWN'],[503,'COMMAND_RESULT_UNKNOWN']] as const)('preserves the existing command transport HTTP %s mapping',async(status,code)=>{
 const a=await authenticated({},config({...options,TESLA_COMMAND_PROXY_URL:'https://existing-proxy.test'})),l=await new Sessions(a.env).open(a.id);
 const provider=external(url=>{expect(new URL(url).origin).toBe('https://existing-proxy.test');return json({error:'SYNTHETIC TEST ONLY'},status);});
 await expect(new TeslaClient(a.env,l).command('/api/1/vehicles/TEST-VIN/command/navigation_request',{type:'share_ext_content_raw',value:{'android.intent.extra.TEXT':'public test destination'},locale:'ko-KR',timestamp_ms:'1'})).rejects.toMatchObject({code});expect(provider).toHaveBeenCalledOnce();await l.save(true);
});
it('maps signed public points then transmits one ordered batch through mocked Fleet REST only after consent',async()=>{
 const env=config({...options,TESLA_MULTI_STOP_MODE:'enabled',TESLA_MULTI_STOP_SEND_ENABLED:'true',GOOGLE_PLACE_MAPPING_ENABLED:'true',GOOGLE_PLACES_API_KEY:'mock-only'});
 const a=await authenticated({},env);
 const points=itinerary(false).map(p=>({...p,poiId:'osm:node:'+p.order,region:'부산'}));
 const legs=points.slice(1).map((_,i)=>({fromOrder:i,toOrder:i+1,distanceKm:1,durationSeconds:60,geometry:null}));
 const proof=await issue('dyn-synthetic-map',finish(points,{legs,status:'ROAD_ROUTED',provider:'TEST',geometryStatus:'NOT_AVAILABLE'},0,'UNAVAILABLE',[]),env.NAVIGATION_TICKET_SECRET);
 const commands:unknown[]=[];
 const http=external((url,init)=>{
  if(url.endsWith(':searchText')){
   const query=JSON.parse(String(init?.body)).textQuery;
   const match=points.find(p=>p.name+' 부산'===query)!;
   return json({places:[{id:'SyntheticPlace'+match.order}]});
  }
  if(url.startsWith('https://places.googleapis.com/')){
   const p=points[Number(url.slice(-1))];return json({location:{latitude:p.latitude,longitude:p.longitude}});
  }
  if(url.endsWith('/command/navigation_waypoints_request')){
   commands.push(JSON.parse(String(init?.body)));return json({response:{result:true}});
  }
  if(url.endsWith('/vehicles/TEST-VIN'))return json({response:{state:'online'}});
  throw Error('unexpected transport');
 });
 const {planId}=await(await a.post('navigation/multi/preview',{ticket:proof})).json() as {planId:string};
 expect(await(await a.post('navigation/multi/dry-run',{planId})).json()).toMatchObject({status:'DRY_RUN_BLOCKED',commandCount:0});expect(http).not.toHaveBeenCalled();
 for(const p of points.slice(1))expect(await(await a.post('navigation/multi/map-places',{planId,order:p.order})).json()).toMatchObject({googlePlaceCoverage:{matchedCount:p.order},commandStatus:'COMMAND_NOT_SENT'});
 const body={waypoints:points.slice(1).map(p=>'refId:SyntheticPlace'+p.order).join(',')};
 expect(await(await a.post('navigation/multi/dry-run',{planId})).json()).toMatchObject({wireRequests:[{body}],commandCount:1});
 const input={planId,confirmAllStops:true,replaceNavigation:true};
 expect(await(await a.post('navigation/multi/send',input)).json()).toMatchObject({error:'GOOGLE_PLACE_REVIEW_REQUIRED'});
 expect(await(await a.post('navigation/multi/send',{...input,confirmMappedPlaces:true})).json()).toMatchObject({commandStatus:'COMMAND_API_ACCEPTED',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'});
 await a.post('navigation/multi/send',{...input,confirmMappedPlaces:true});expect(commands).toEqual([body]);
});
