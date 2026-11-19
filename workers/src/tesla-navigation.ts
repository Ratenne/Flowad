import {z} from 'zod';
import type {Env,Point,Stop,Plan} from './types';
import {Failure,hash} from './utils';
import {resolve} from './tickets';
import {assessGooglePlace,googlePlaceCoverage} from './google-place-mapping';

// Evidence pin, not a claim about an operator's installed proxy version.
export const navigationSdk={repository:'teslamotors/vehicle-command',commit:'0a582da430c4aca6d397fb6cbed5b4d6bb380125',latestTag:'v0.4.1'} as const;
export const navigationStrategy=z.enum(['WAYPOINTS','GPS_ORDERED']);
export type NavigationStrategy=z.infer<typeof navigationStrategy>;
// Flowad's existing signed-ticket limit; the Tesla API maximum is unconfirmed.
export const maxNavigationStops=16;
// Internal visit indices are not Tesla's insertion enum. These values are
// corroborated by the public protocol implementation; the pinned official SDK
// contains no navigation GPS enum/message. Live use stays blocked separately.
export const gpsInsertionOrder=Object.freeze({REPLACE:0,PREPEND:1,APPEND:2} as const);
export const gpsOrderEvidence={publicImplementation:'Teslemetry/python-tesla-fleet-api',commit:'f7f39c8c2320ee3289a8a0242b3629e355ef532e',officialSdkCrossCheck:'ENUM_AND_COMMAND_ABSENT',officialSemanticsVerified:false} as const;
const gpsBody=z.object({lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),order:z.union([z.literal(0),z.literal(1),z.literal(2)])}).strict();
const waypointBody=z.object({waypoints:z.string().regex(/^refId:[A-Za-z0-9_-]{10,512}(,refId:[A-Za-z0-9_-]{10,512})*$/)}).strict();
export function multiCapabilities(env:Env){
 const featureEnabled=['dry-run','enabled'].includes(env.TESLA_MULTI_STOP_MODE??''),live=env.TESLA_MULTI_STOP_MODE==='enabled'&&env.TESLA_MULTI_STOP_SEND_ENABLED==='true';
 return {featureEnabled,mode:!featureEnabled?'OFF':live?'EXPLICIT_CONSENT_REQUIRED':'DRY_RUN_ONLY',liveSendEnabled:live,
  commandStatus:'COMMAND_NOT_SENT',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED',
  limits:{flowadMaxStops:maxNavigationStops,teslaMaxStops:null},
  transport:env.TESLA_COMMAND_PROXY_URL?'EXISTING_PROXY':'EXISTING_FLEET_REST',
  installedProxyVersion:'NOT_VERIFIED',sdk:navigationSdk,
  methods:([
   ['WAYPOINTS','navigation_waypoints_request'],['GPS_ORDERED','navigation_gps_request']
  ] as const).map(([strategy,command])=>({strategy,command,endpointDocumented:true,
   schemaStatus:'REQUIRED_FIELDS_CONFIRMED',serializationAvailable:true,proxySupport:'UNSUPPORTED_AT_SDK_PIN',
   fulfillsSingleRequestGoal:strategy==='WAYPOINTS',...(strategy==='GPS_ORDERED'?{orderEvidence:gpsOrderEvidence}:{requiresVerifiedGooglePlaceIds:true}),
   vehicleSupport:'NOT_VERIFIED',realVehicleVerified:false,canSend:strategy==='WAYPOINTS'&&live&&!env.TESLA_COMMAND_PROXY_URL,
   transportStatus:env.TESLA_COMMAND_PROXY_URL?'EXISTING_PROXY_COMMAND_SUPPORT_UNCONFIRMED':'DOCUMENTED_FLEET_REST_VEHICLE_MAY_REQUIRE_SIGNING'}))};
}
export function requireMultiFeature(env:Env){if(!['dry-run','enabled'].includes(env.TESLA_MULTI_STOP_MODE??''))throw new Failure('MULTI_STOP_FEATURE_DISABLED');}
export function multiNavigationOutcome(p:Plan){
 if(p.mode!=='MULTI_STOP')return {};
 return {mode:p.mode,stops:p.stops,attemptedCommands:p.multi?.attemptedCommands,acceptedCommands:p.multi?.acceptedCommands,totalCommands:p.multi?.totalCommands,
  commandStatus:p.status==='NOT_SENT'?'COMMAND_NOT_SENT':p.status==='API_ACCEPTED'?'COMMAND_API_ACCEPTED':p.status==='SENDING'||['COMMAND_RESULT_UNKNOWN','COMMAND_TIMEOUT'].includes(p.error??'')?'COMMAND_RESULT_UNKNOWN':'COMMAND_REJECTED',
  vehicleNavigationStatus:p.vehicleStatus==='VEHICLE_CONFIRMED'?'VEHICLE_NAVIGATION_CONFIRMED':'VEHICLE_NAVIGATION_NOT_CONFIRMED'};
}
export function orderedNavigationStops(points:Point[]):Stop[]{
 if(points.length<3||points[0]?.type!=='ORIGIN')throw new Failure('INVALID_NAVIGATION_ITINERARY');
 if(points.length-1>maxNavigationStops)throw new Failure('WAYPOINT_LIMIT_EXCEEDED');
 let destination=false;
 for(let i=0;i<points.length;i++){
  const p=points[i];
  if(p.order!==i||!p.name.trim()||p.name.length>200||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180||p.verification==='NO_CAR_ACCESS')throw new Failure('INVALID_NAVIGATION_ITINERARY');
  if(!i)continue;
  if(p.type==='DESTINATION'){if(destination)throw new Failure('INVALID_NAVIGATION_ITINERARY');destination=true;}
  else if(p.type==='RETURN'){if(!destination||i!==points.length-1)throw new Failure('INVALID_NAVIGATION_ITINERARY');}
  else if(!['SCENIC_WAYPOINT','CHARGING_STOP'].includes(p.type)||destination)throw new Failure('INVALID_NAVIGATION_ITINERARY');
 }
 if(!destination||!['DESTINATION','RETURN'].includes(points.at(-1)!.type))throw new Failure('INVALID_NAVIGATION_ITINERARY');
 // The car starts at its own location. RETURN stays, even at ORIGIN's coordinates.
 // Repeated visits are intentional; never deduplicate coordinates or names.
 return points.slice(1).map(p=>({order:p.order,kind:p.type,name:p.name,latitude:p.latitude,longitude:p.longitude,navigationText:`${p.latitude},${p.longitude}`,...(p.googlePlace?{googlePlace:p.googlePlace}:{}),...(p.googlePlaceMappingIssue?{googlePlaceMappingIssue:p.googlePlaceMappingIssue}:{})}));
}
export async function verifiedNavigationItinerary(ticket:string,env:Env){
 const saved=await resolve(ticket,env.NAVIGATION_TICKET_SECRET),r=saved.route,summary=r.roadSummary;
 if(r.status!=='ROAD_ROUTED'||!summary)throw new Failure('ROAD_VERIFICATION_REQUIRED');
 const stops=orderedNavigationStops(r.points);
 if(summary.legs.length!==stops.length||summary.legs.some((l,i)=>l.fromOrder!==i||l.toOrder!==i+1))throw new Failure('INVALID_TICKET');
 return {courseId:saved.courseId,expiresAt:saved.expiresAt,origin:r.points[0],stops,
  roundTrip:stops.at(-1)!.kind==='RETURN',itineraryHash:await hash(JSON.stringify([r.points,summary]))};
}
export interface NavigationCommandAdapter {
 strategy:NavigationStrategy;
 command:'navigation_waypoints_request'|'navigation_gps_request';
 // Body fields are confirmed; insertion semantics/transport certification are
 // independent live-send gates rather than reasons to omit the Dry-run plan.
 serialize(stops:Stop[]):ReadonlyArray<NavigationWireCommand>;
}
export interface NavigationWireCommand {command:'navigation_waypoints_request'|'navigation_gps_request';body:Record<string,unknown>}
function validateStops(stops:Stop[]){
 if(!stops.length||stops.length>maxNavigationStops)throw new Failure('WAYPOINT_LIMIT_EXCEEDED');
 if(stops.some((p,i)=>p.order!==i+1||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180))throw new Failure('INVALID_NAVIGATION_ITINERARY');
}
export const navigationAdapters:Record<NavigationStrategy,NavigationCommandAdapter>={
 WAYPOINTS:{strategy:'WAYPOINTS',command:'navigation_waypoints_request',serialize(stops){
  validateStops(stops);
  const coverage=googlePlaceCoverage(stops);
  if(!coverage.complete){const error=new Failure('GOOGLE_PLACE_IDS_REQUIRED');error.context={waypointOrders:coverage.missing.map(p=>p.order)};throw error;}
  const ids=stops.map(p=>{const result=assessGooglePlace(p,p.googlePlace);if('reason'in result)throw new Failure('GOOGLE_PLACE_IDS_REQUIRED');return result.id;});
  return [{command:'navigation_waypoints_request',body:waypointBody.parse({waypoints:ids.map(id=>'refId:'+id).join(',')})}];
 }},
 GPS_ORDERED:{strategy:'GPS_ORDERED',command:'navigation_gps_request',serialize(stops){
  validateStops(stops);
  return stops.map((p,i)=>({command:'navigation_gps_request',body:gpsBody.parse({lat:p.latitude,lon:p.longitude,order:i===0?gpsInsertionOrder.REPLACE:gpsInsertionOrder.APPEND})}));
 }}
};
export function navigationDryRun(stops:Stop[],strategy:NavigationStrategy,env:Env){
 requireMultiFeature(env);
 validateStops(stops);
 const coverage=googlePlaceCoverage(stops);
 if(strategy==='WAYPOINTS'&&!coverage.complete)return {status:'DRY_RUN_BLOCKED',scope:'SINGLE_REQUEST_PLACE_ID_COVERAGE',
  strategy,command:navigationAdapters[strategy].command,stopCount:stops.length,commandCount:0,schemaValidated:false,wireRequests:[],
  fulfillsSingleRequestGoal:false,commandStatus:'COMMAND_NOT_SENT',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED',
  canSend:false,googlePlaceCoverage:coverage,blockers:['GOOGLE_PLACE_IDS_REQUIRED'],capabilities:multiCapabilities(env)};
 const commands=navigationAdapters[strategy].serialize(stops);
 return {status:'DRY_RUN_VALIDATED',scope:'SIGNED_ITINERARY_AND_WIRE_PLAN',
  commandStatus:'COMMAND_NOT_SENT',vehicleNavigationStatus:'VEHICLE_NAVIGATION_NOT_CONFIRMED',
  strategy,command:navigationAdapters[strategy].command,stopCount:stops.length,
  schemaValidated:true,wireRequests:commands,commandCount:commands.length,fulfillsSingleRequestGoal:strategy==='WAYPOINTS'&&commands.length===1,googlePlaceCoverage:coverage,orderSemanticsVerifiedOfficially:strategy==='GPS_ORDERED'?false:null,canSend:multiCapabilities(env).methods.find(m=>m.strategy===strategy)!.canSend,blockers:[...(strategy==='GPS_ORDERED'?['GPS_ORDER_OFFICIAL_CROSSCHECK_PENDING']:[]),...(env.TESLA_COMMAND_PROXY_URL?['PROXY_COMMAND_UNSUPPORTED']:[]),'VEHICLE_SUPPORT_UNCONFIRMED'],
  capabilities:multiCapabilities(env)};
}
export function requireMultiSend(env:Env,strategy:NavigationStrategy,stops:Stop[]):ReadonlyArray<NavigationWireCommand>{
 requireMultiFeature(env);
 if(env.TESLA_MULTI_STOP_MODE!=='enabled'||env.TESLA_MULTI_STOP_SEND_ENABLED!=='true')throw new Failure('MULTI_STOP_SEND_DISABLED');
 const commands=navigationAdapters[strategy].serialize(stops);
 if(strategy==='GPS_ORDERED')throw new Failure('GPS_ORDER_OFFICIAL_CROSSCHECK_PENDING');
 // Respect an existing configured proxy: the inspected official proxy does
 // not forward these unknown commands. Never bypass it automatically.
 if(env.TESLA_COMMAND_PROXY_URL)throw new Failure('PROXY_COMMAND_UNSUPPORTED');
 // Reuse the existing Fleet REST origin. The user-approved request can still
 // be rejected by a vehicle that requires signed protocol support.
 return commands;
}

export type DispatchResult={status:'SENDING'|'API_ACCEPTED'|'API_FAILED';attemptedCommands:number;acceptedCommands:number;totalCommands:number;pending:boolean;error?:string};
export function commandAcceptance(raw:unknown):'ACCEPTED'|'REJECTED'|'UNKNOWN'{
 const r=z.object({response:z.object({result:z.boolean()})}).safeParse(raw);
 return !r.success?'UNKNOWN':r.data.response.result?'ACCEPTED':'REJECTED';
}
// Command-independent transaction engine for a future certified serializer.
// A checkpoint must succeed before each effect. It never retries or falls back
// from batch to ordered GPS/single destination after an uncertain response.
export async function dispatchNavigation(commands:ReadonlyArray<()=>Promise<unknown>>,checkpoint:(r:DispatchResult)=>Promise<void>):Promise<DispatchResult>{
 if(!commands.length||commands.length>maxNavigationStops)throw new Failure('WAYPOINT_LIMIT_EXCEEDED');
 const state:DispatchResult={status:'SENDING',attemptedCommands:0,acceptedCommands:0,totalCommands:commands.length,pending:false};
 for(const command of commands){
  state.attemptedCommands++;state.pending=true;state.error='COMMAND_RESULT_UNKNOWN';
  await checkpoint({...state});
  let result:'ACCEPTED'|'REJECTED'|'UNKNOWN';
  try{result=commandAcceptance(await command());}catch(e){result=e instanceof Failure&&['PERMISSION_DENIED','REAUTH_REQUIRED','UNSUPPORTED_COMMAND','COMMAND_PROTOCOL_REQUIRED','PAYMENT_REQUIRED','PRECONDITION_FAILED','INCORRECT_REGION','NO_DATA','REQUEST_FAILED'].includes(e.code)?'REJECTED':'UNKNOWN';}
  if(result==='ACCEPTED'){state.acceptedCommands++;delete state.error;}
  else{state.status='API_FAILED';state.error=result==='UNKNOWN'?'COMMAND_RESULT_UNKNOWN':state.acceptedCommands?'PARTIAL_COMMAND_ACCEPTANCE':'COMMAND_REJECTED';state.pending=result==='UNKNOWN'||state.acceptedCommands>0;await checkpoint({...state});return state;}
 }
 state.status='API_ACCEPTED';state.pending=true;await checkpoint({...state});return state;
}
