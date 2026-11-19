import {z} from 'zod';
import type {Coordinate,GooglePlaceReference,Point,Stop} from './types';
import {coordinate,distance,Failure} from './utils';
import reviewed from '../data/google-place-mappings.json';
// An ID's string shape is not identity verification. This attestation is accepted
// only from the server's reviewed source and carried inside the signed ticket.
export const googlePlaceReference=z.object({
 id:z.string().min(10).max(512).regex(/^[A-Za-z0-9_-]+$/),source:z.literal('GOOGLE_PLACES'),verifiedAt:z.iso.datetime({offset:true}),
 identityConfirmed:z.literal(true),location:coordinate.strict(),matchedPoint:coordinate.extend({name:z.string().min(1).max(200)}).strict(),
 verificationMethod:z.enum(['MANUAL_REVIEW','TEXT_QUERY_UNIQUE_LOCATION']).optional(),nameVerified:z.boolean().optional()
}).strict();
export const googlePlaceMatchPolicy={maxDistanceMeters:25,automaticNearestMatch:false,externalLookupEnabled:false} as const;
type Target=Coordinate&{name:string};
export function assessGooglePlace(target:Target,value:unknown):{id:string;reference:GooglePlaceReference}|{reason:string}{
 if(value===undefined)return {reason:'GOOGLE_PLACE_ID_MISSING'};
 const parsed=googlePlaceReference.safeParse(value);if(!parsed.success)return {reason:'GOOGLE_PLACE_IDENTITY_UNVERIFIED'};
 const r=parsed.data;
 if(r.matchedPoint.name!==target.name||r.matchedPoint.latitude!==target.latitude||r.matchedPoint.longitude!==target.longitude)return {reason:'MAPPING_TARGET_CHANGED'};
 if(distance(target.latitude,target.longitude,r.location.latitude,r.location.longitude)*1000>googlePlaceMatchPolicy.maxDistanceMeters)return {reason:'GOOGLE_PLACE_LOCATION_MISMATCH'};
 return {id:r.id,reference:r};
}
// For a future reviewed/offline data importer. No HTTP endpoint accepts place IDs
// or review assertions from the browser; no paid Google API is invoked here.
export function attachReviewedGooglePlace(point:Point,review:GooglePlaceReference):Point{
 const result=assessGooglePlace(point,review);if('reason'in result)throw new Failure(result.reason);
 return {...point,googlePlace:result.reference};
}
export function attachStoredGooglePlace(poiId:string,point:Point,records:Record<string,unknown>=reviewed.mappings):Point{
 if(!Object.hasOwn(records,poiId))return point;
 const parsed=googlePlaceReference.safeParse(records[poiId]);
 // Bad mapping data never disables discovery or fabricates another place.
 if(!parsed.success)return {...point,googlePlaceMappingIssue:'GOOGLE_PLACE_IDENTITY_UNVERIFIED'};
 return {...point,googlePlace:parsed.data};
}
export function googlePlaceCoverage(stops:Stop[]){
 const missing=stops.flatMap(p=>{const result=p.googlePlaceMappingIssue?{reason:p.googlePlaceMappingIssue}:assessGooglePlace(p,p.googlePlace);return 'reason'in result?[{order:p.order,name:p.name,reason:result.reason}]:[];});
 return {complete:missing.length===0&&stops.length>0,matchedCount:stops.length-missing.length,totalCount:stops.length,missing,
  source:'SIGNED_TICKET'};
}
