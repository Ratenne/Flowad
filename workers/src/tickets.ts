import { z } from 'zod';
import type { Route } from './types';
import { bytes, coordinate, Failure, from64, hmacKey, now, url64 } from './utils';
import {googlePlaceReference} from './google-place-mapping';
import {assessGooglePlace} from './google-place-mapping';
import type {GooglePlaceReference} from './types';
const snapshot = z.object({ version: z.literal(1), expiresAt: z.number().int(), courseId: z.string(), route: z.object({
  status: z.string(), points: z.array(coordinate.extend({ order: z.number().int(), type: z.string(), name: z.string(), source: z.string(), verification: z.string(), originalSnapDistanceMeters: z.number().nullable(),googlePlace:googlePlaceReference.optional(),googlePlaceMappingIssue:z.literal('GOOGLE_PLACE_IDENTITY_UNVERIFIED').optional(),poiId:z.string().max(150).optional(),region:z.string().max(100).optional(),poiLocation:coordinate.optional() })).min(2).max(17),
  roadSummary:z.object({generatedAt:z.string(),legs:z.array(z.object({fromOrder:z.number().int(),toOrder:z.number().int(),distanceKm:z.number().positive(),durationSeconds:z.number().int().positive(),geometry:z.null()})).min(1).max(16)}).optional()
}) });
const ticketLifetime=300;
const selectionLifetime=1800;
const selectionDomain='flowad:road-selection:v1:';
async function signSnapshot(value:unknown,secret:string,domain=''){
 const payload=bytes(JSON.stringify(value));
 const encoded=url64(payload),signed=domain?bytes(domain+encoded):payload;
 return `${encoded}.${url64(await crypto.subtle.sign('HMAC',await hmacKey(secret),signed))}`;
}
export async function issue(id: string, route: Route, secret: string) {
  const roadSummary=route.status==='ROAD_ROUTED'?{generatedAt:route.generatedAt,legs:route.legs.map(l=>({...l,geometry:null}))}:undefined;
  return signSnapshot({ version:1, expiresAt:now()+ticketLifetime, courseId:id, route:{points:route.points,status:route.status,roadSummary} },secret);
}
// A selection authorizes a fresh road check. Its signing domain is separate
// from navigation tickets, and it carries no road proof.
export async function issueCourseCredentials(id:string,route:Route,secret:string){
 const [navigationTicket,selectionToken]=await Promise.all([
  issue(id,route,secret),
  signSnapshot({version:1,expiresAt:now()+selectionLifetime,courseId:id,route:{points:route.points,status:'ESTIMATED_NOT_ROAD_ROUTED'}},secret,selectionDomain)
 ]);
 return {navigationTicket,selectionToken};
}
export function resolve(token:string,secret:string){
 return readSnapshot(token,secret,ticketLifetime,'TICKET_EXPIRED','INVALID_TICKET');
}
export function resolveSelection(token:string,secret:string){
 return readSnapshot(token,secret,selectionLifetime,'SELECTION_EXPIRED','INVALID_SELECTION',selectionDomain);
}
async function readSnapshot(token:string,secret:string,lifetime:number,expiredCode:string,invalidCode:string,domain=''){
  let reason='format';
  try {
    if (token.length>65536) throw new Error();
    const parts=token.split('.'); if(parts.length!==2) throw new Error();
    const payload=from64(parts[0]);
    reason='signature';
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), from64(parts[1]), domain?bytes(domain+parts[0]):payload)) throw new Error();
    reason='schema';
    const s = snapshot.parse(JSON.parse(new TextDecoder().decode(payload)));
    const current=now();
    if (s.expiresAt<=current) throw new Failure(expiredCode);
    reason='future_expiry';
    if (s.expiresAt>current+lifetime) throw new Error();
    return { courseId: s.courseId, route: s.route,expiresAt:s.expiresAt };
  } catch(e) { if(e instanceof Failure&&e.code===expiredCode)throw e;console.warn(JSON.stringify({event:domain?'road_selection_rejected':'navigation_ticket_rejected',reason}));throw new Failure(invalidCode); }
}
// Add verified Google metadata without changing route coordinates/order or
// extending the original road proof's expiry. This is server-only, not an API
// for browser-supplied mappings.
export async function addGoogleMappings(token:string,references:Map<number,GooglePlaceReference>,secret:string){
 const saved=await resolve(token,secret);
 if(saved.route.status!=='ROAD_ROUTED'||!saved.route.roadSummary)throw new Failure('ROAD_VERIFICATION_REQUIRED');
 const points=saved.route.points.map(p=>{
  const reference=references.get(p.order);if(!reference)return p;
  const result=assessGooglePlace(p,reference);if('reason'in result)throw new Failure('GOOGLE_PLACE_IDS_REQUIRED');
  const mapped={...p,googlePlace:result.reference};delete mapped.googlePlaceMappingIssue;return mapped;
 });
 return signSnapshot({version:1,expiresAt:saved.expiresAt,courseId:saved.courseId,route:{...saved.route,points}},secret);
}
