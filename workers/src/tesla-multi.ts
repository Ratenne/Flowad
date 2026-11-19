import type {Hono,Context} from 'hono';
import {z} from 'zod';
import type {Bindings,Session,Plan} from './types';
import type {Lease} from './repository';
import {configured,TeslaClient} from './tesla-client';
import {Failure,now} from './utils';
import {multiCapabilities,navigationStrategy,verifiedNavigationItinerary,navigationDryRun,requireMultiFeature,dispatchNavigation} from './tesla-navigation';
import {googlePlaceCoverage} from './google-place-mapping';
import {mapGooglePlace,googlePlacesPolicy} from './google-places';
import {resolve,addGoogleMappings} from './tickets';
import type {GooglePlaceReference} from './types';
type C=Context<Bindings>;
type Dependencies={lease:(c:C)=>Lease;selected:(s:Session)=>string;outcome:(p:Plan)=>unknown};
const previewInput=z.object({ticket:z.string().min(1).max(65536),strategy:navigationStrategy.default('GPS_ORDERED')}).strict();
const planInput=z.object({planId:z.string().uuid()}).strict();
export function mountTeslaMulti(tesla:Hono<Bindings>,deps:Dependencies){
 const operation=(handler:(c:C)=>Promise<unknown>)=>async(c:C)=>{
  try{return c.json(await handler(c) as Record<string,unknown>);}
  catch(e){const error=e instanceof Failure?e:e instanceof z.ZodError||e instanceof SyntaxError?new Failure('INVALID_REQUEST'):new Failure('SERVICE_UNAVAILABLE',503);
   const p=deps.lease(c).data.plan;
   return c.json({...p?.mode==='MULTI_STOP'&&p.multi?.attemptedCommands?deps.outcome(p) as Record<string,unknown>:{commandStatus:'COMMAND_NOT_SENT',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'},error:error.code},error.status);}
 };
 const authenticated=(c:C)=>{
  requireMultiFeature(c.env);if(!configured(c.env))throw new Failure('COMMAND_NOT_CONFIGURED');
  const s=deps.lease(c).data;deps.selected(s);if(!s.commands)throw new Failure('COMMAND_PERMISSION_REQUIRED');return s;
 };
 const plan=async(c:C,id:string)=>{
  const s=authenticated(c),p=s.plan;
  if(!p||p.id!==id||p.expires<=now()||p.vehicle!==deps.selected(s))throw new Failure('PLAN_EXPIRED');
  if(p.mode!=='MULTI_STOP'||!p.multi)throw new Failure('WRONG_NAVIGATION_MODE');
  const trusted=await verifiedNavigationItinerary(p.multi.ticket,c.env);
  if(trusted.itineraryHash!==p.multi.itineraryHash||JSON.stringify(trusted.stops)!==JSON.stringify(p.stops))throw new Failure('INVALID_TICKET');
  return p;
 };
 tesla.post('/navigation/multi/preview',operation(async c=>{
  const s=authenticated(c);if(s.plan?.pending)return deps.outcome(s.plan);
  // A failed new request cannot leave an earlier, unsent plan usable.
  delete s.plan;
  const input=previewInput.parse(await c.req.json()),trusted=await verifiedNavigationItinerary(input.ticket,c.env);
  const p:Plan={id:crypto.randomUUID(),mode:'MULTI_STOP',vehicle:deps.selected(s),expires:Math.min(now()+300,trusted.expiresAt),
   stops:trusted.stops,attempted:0,status:'NOT_SENT',vehicleStatus:'VEHICLE_NOT_CONFIRMED',pending:false,roadVerified:true,
   multi:{strategy:input.strategy,ticket:input.ticket,itineraryHash:trusted.itineraryHash,dryRunValidated:false,attemptedCommands:0,acceptedCommands:0,totalCommands:null}};
  p.multi!.mappingResults=p.stops.map(stop=>({order:stop.order,name:stop.name,status:stop.googlePlace&&!googlePlaceCoverage([stop]).missing.length?'MAPPED':'NOT_REQUESTED',searchCalls:0,detailsCalls:0}));
  s.plan=p;
  return {planId:p.id,mode:p.mode,status:'PREVIEW_READY',strategy:input.strategy,origin:trusted.origin,stops:p.stops,roundTrip:trusted.roundTrip,
   roadVerified:true,expiresInSeconds:p.expires-now(),commandStatus:'COMMAND_NOT_SENT',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED',
   mappingResults:p.multi!.mappingResults,mappingConfigured:!!c.env.GOOGLE_PLACES_KEY&&c.env.GOOGLE_PLACE_MAPPING_ENABLED==='true',authorizationStatus:'SESSION_SCOPE_ONLY',googlePlaceCoverage:googlePlaceCoverage(p.stops),capabilities:multiCapabilities(c.env,p.stops)};
 }));
 tesla.post('/navigation/multi/map-places',operation(async c=>{
  const input=planInput.extend({order:z.number().int().min(1).max(16)}).parse(await c.req.json()),p=await plan(c,input.planId);
  if(p.status!=='NOT_SENT'||p.pending)throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  if(p.multi!.strategy!=='WAYPOINTS')throw new Failure('WRONG_NAVIGATION_MODE');
  const saved=await resolve(p.multi!.ticket,c.env.NAVIGATION_TICKET_SECRET),references=new Map<number,GooglePlaceReference>();
  const signal=AbortSignal.timeout(googlePlacesPolicy.operationMs);
  if(input.order>=saved.route.points.length)throw new Failure('INVALID_REQUEST');
  const result=await mapGooglePlace(saved.route.points[input.order],c.env,signal);
  if(result.reference)references.set(result.order,result.reference);
  const previous=p.multi!.mappingResults??p.stops.map(stop=>({order:stop.order,name:stop.name,status:'NOT_REQUESTED',searchCalls:0,detailsCalls:0}));
  const results=previous.map(entry=>entry.order!==result.order?entry:{order:result.order,name:result.name,status:result.status,reason:result.reason,cached:result.cached,searchCalls:entry.searchCalls+(result.searchCalls??0),detailsCalls:entry.detailsCalls+(result.detailsCalls??0)});
  p.multi!.mappingResults=results;
  const ticket=await addGoogleMappings(p.multi!.ticket,references,c.env.NAVIGATION_TICKET_SECRET),trusted=await verifiedNavigationItinerary(ticket,c.env);
  p.stops=trusted.stops;p.multi!.ticket=ticket;p.multi!.itineraryHash=trusted.itineraryHash;p.multi!.dryRunValidated=false;p.multi!.totalCommands=null;
  return {planId:p.id,mode:p.mode,status:'PREVIEW_READY',strategy:p.multi!.strategy,origin:trusted.origin,stops:p.stops,roundTrip:trusted.roundTrip,
   roadVerified:true,googlePlaceCoverage:googlePlaceCoverage(p.stops),mappingResults:results,attribution:'Google Maps',
   capabilities:multiCapabilities(c.env,p.stops),commandStatus:'COMMAND_NOT_SENT',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED'};
 }));
 tesla.post('/navigation/multi/dry-run',operation(async c=>{
  const input=planInput.parse(await c.req.json()),p=await plan(c,input.planId);
  if(p.status!=='NOT_SENT'||p.pending)throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  const result=navigationDryRun(p.stops,p.multi!.strategy,c.env);p.multi!.dryRunValidated=result.status==='DRY_RUN_VALIDATED';p.multi!.totalCommands=result.commandCount;
  return {...result,mappingConfigured:!!c.env.GOOGLE_PLACES_KEY&&c.env.GOOGLE_PLACE_MAPPING_ENABLED==='true',mappingResults:p.multi!.mappingResults??[],planId:p.id,mode:p.mode,stops:p.stops,authorizationStatus:'SESSION_SCOPE_ONLY'};
 }));
 tesla.post('/navigation/multi/send',operation(async c=>{
  const input=planInput.extend({confirmAllStops:z.literal(true),replaceNavigation:z.literal(true),confirmMappedPlaces:z.boolean().optional()}).parse(await c.req.json()),p=await plan(c,input.planId);
  if(p.status!=='NOT_SENT'||p.pending)throw new Failure('DUPLICATE_OR_UNCONFIRMED_COMMAND');
  if(!p.multi!.dryRunValidated)throw new Failure('DRY_RUN_REQUIRED');
  if(p.multi!.strategy==='WAYPOINTS'&&p.stops.some(s=>s.googlePlace?.verificationMethod==='TEXT_QUERY_UNIQUE_LOCATION')&&!input.confirmMappedPlaces)throw new Failure('GOOGLE_PLACE_REVIEW_REQUIRED');
  // No attempt is persisted and no token refresh, vehicle lookup or command is
  // performed while either the live flag or a certified serializer is missing.
  const l=deps.lease(c),s=l.data,client=new TeslaClient(c.env,l),base='/api/1/vehicles/'+encodeURIComponent(s.vehicles[deps.selected(s)]);
  const commands=client.multiNavigationCommands(base,p.multi!.strategy,p.stops);
  await client.access();if(!s.commands)throw new Failure('COMMAND_PERMISSION_REQUIRED');
  const vehicle=z.object({response:z.object({state:z.literal('online')})}).safeParse(await client.get(base));
  if(!vehicle.success)throw new Failure('OFFLINE_OR_ASLEEP');
  await dispatchNavigation(commands,async progress=>{
   if(progress.status==='SENDING'&&progress.error==='COMMAND_RESULT_UNKNOWN'&&p.expires<=now())throw new Failure('PLAN_EXPIRED');
   p.status=progress.status;p.pending=progress.pending;p.error=progress.error;
   p.multi!.attemptedCommands=progress.attemptedCommands;p.multi!.acceptedCommands=progress.acceptedCommands;p.multi!.totalCommands=progress.totalCommands;
   await l.save();
  });
  return deps.outcome(p);
 }));
 tesla.post('/navigation/multi/confirm',operation(async c=>{
  const input=planInput.extend({matched:z.boolean(),confirmedStopCount:z.number().int().min(0),confirmedVisitOrder:z.boolean()}).parse(await c.req.json());
  const s=deps.lease(c).data,p=s.plan;
  // Reconciliation has no vehicle effect and must remain possible after expiry
  // or a feature rollback. Never turn it into another command attempt.
  if(!p||p.id!==input.planId||p.mode!=='MULTI_STOP'||!p.multi||p.vehicle!==deps.selected(s))throw new Failure('PLAN_EXPIRED');
  if(!p.pending)throw new Failure('NO_PENDING_COMMAND');
  if(input.matched&&(p.error==='PARTIAL_COMMAND_ACCEPTANCE'||input.confirmedStopCount!==p.stops.length||!input.confirmedVisitOrder||p.multi!.totalCommands===null||p.multi!.attemptedCommands!==p.multi!.totalCommands))throw new Failure('INCOMPLETE_ROUTE_CONFIRMATION');
  p.pending=false;if(input.matched)p.vehicleStatus='VEHICLE_CONFIRMED';return deps.outcome(p);
 }));
}
