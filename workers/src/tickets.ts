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
export async function issue(id: string, route: Route, secret: string) {
  const roadSummary=route.status==='ROAD_ROUTED'?{generatedAt:route.generatedAt,legs:route.legs.map(l=>({...l,geometry:null}))}:undefined;
  const payload = bytes(JSON.stringify({ version: 1, expiresAt: now()+300, courseId: id, route: { points: route.points, status: route.status,roadSummary } }));
  return `${url64(payload)}.${url64(await crypto.subtle.sign('HMAC', await hmacKey(secret), payload))}`;
}
export async function resolve(token: string, secret: string) {
  let reason='format';
  try {
    if (token.length>65536) throw new Error();
    const parts=token.split('.'); if(parts.length!==2) throw new Error();
    const payload=from64(parts[0]);
    reason='signature';
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), from64(parts[1]), payload)) throw new Error();
    reason='schema';
    const s = snapshot.parse(JSON.parse(new TextDecoder().decode(payload)));
    if (s.expiresAt<=now()) throw new Failure('TICKET_EXPIRED');
    reason='future_expiry';
    if (s.expiresAt>now()+300) throw new Error();
    return { courseId: s.courseId, route: s.route,expiresAt:s.expiresAt };
  } catch(e) { if(e instanceof Failure&&e.code==='TICKET_EXPIRED')throw e;console.warn(JSON.stringify({event:'navigation_ticket_rejected',reason}));throw new Failure('INVALID_TICKET'); }
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
 const payload=bytes(JSON.stringify({version:1,expiresAt:saved.expiresAt,courseId:saved.courseId,route:{...saved.route,points}}));
 return `${url64(payload)}.${url64(await crypto.subtle.sign('HMAC',await hmacKey(secret),payload))}`;
}
