import {z} from 'zod';
import catalog from '../../backend/src/main/resources/courses.json';
import type {Env} from './types';
import {Failure,hash} from './utils';
import {resolve,resolveSelection,issue} from './tickets';
import {verifyCourse,road,finish} from './routing';
import {battery} from './recommendations';
export const vehicleConditions=z.object({
 vehicleType:z.enum(['ice','ev']).default('ev'),batteryPercent:z.number().min(0).max(100).nullish(),estimatedRangeKm:z.number().positive().max(2000).nullish(),walking:z.boolean().optional(),availableMinutes:z.number().int().min(1).max(1440).optional()
});
export const selectedRequest=vehicleConditions.extend({ticket:z.string().min(1).max(65536)});
export const roadVerificationRequest=z.union([
 selectedRequest.extend({selectionToken:z.never().optional()}),
 vehicleConditions.extend({ticket:z.never().optional(),selectionToken:z.string().min(1).max(65536)})
]);
type RoadVerificationInput=z.infer<typeof roadVerificationRequest>;
// Reuse fresh signed road proof for preparation, without a second OSRM request
// or extending the proof's expiry. Old tickets retain their verification path.
export async function prepareSelected(input:z.infer<typeof selectedRequest>,env:Env){
 const saved=await resolve(input.ticket,env.NAVIGATION_TICKET_SECRET),summary=saved.route.roadSummary;
 if(saved.route.status!=='ROAD_ROUTED'||!summary){const verified=await verifySelected(input,env);return {...verified,expiresAt:(await resolve(verified.navigationTicket,env.NAVIGATION_TICKET_SECRET)).expiresAt};}
 const points=saved.route.points;
 if(summary.legs.length!==points.length-1||summary.legs.some((l,i)=>l.fromOrder!==i||l.toOrder!==i+1))throw new Failure('INVALID_TICKET');
 const stops=points.filter(p=>['SCENIC_WAYPOINT','DESTINATION'].includes(p.type)).length;
 const route=finish(points,{legs:summary.legs,status:'ROAD_ROUTED',provider:'OSRM / OpenStreetMap',geometryStatus:'NOT_REQUESTED_FREE_PLAN'},stops*(input.walking===false?600:1200),'DYNAMIC_ROUTE',['검증된 도로 연결이며 현재 명소 진입·주차는 미확인입니다.']);
 route.generatedAt=summary.generatedAt;
 return {verificationStatus:'ROAD_ROUTE_VERIFIED',roadVerified:true,route,batteryStatus:battery(input,route.distanceKm),withinAvailableMinutes:input.availableMinutes==null?null:route.totalSeconds<=input.availableMinutes*60,navigationTicket:input.ticket,expiresAt:saved.expiresAt,note:'유효한 도로 검증 티켓의 전체 방문 순서를 준비했습니다.'};
}
const pending=new Map<string,ReturnType<typeof verifySelectedOnce>>();
export async function verifySelected(input:RoadVerificationInput,env:Env){
 const key=await hash(JSON.stringify([input,env.ROAD_ROUTING_URL,env.NAVIGATION_TICKET_SECRET]));
 if(pending.has(key))return pending.get(key)!;
 if(pending.size>=8)throw new Failure('ROAD_VERIFICATION_BUSY',503,3);
 const operation=verifySelectedOnce(input,env);pending.set(key,operation);
 try{return await operation;}finally{pending.delete(key);}
}
async function verifySelectedOnce(input:RoadVerificationInput,env:Env){
 const secret=env.NAVIGATION_TICKET_SECRET;
 const saved=input.selectionToken===undefined?await resolve(input.ticket,secret):await resolveSelection(input.selectionToken,secret);
 const first=saved.route.points[0],last=saved.route.points.at(-1)!;
 if(first.type!=='ORIGIN'||!['RETURN','DESTINATION'].includes(last.type))throw new Failure('INVALID_TICKET');
 if(saved.courseId.startsWith('dyn-')){
  if(!['ROAD_ROUTED','ESTIMATED_NOT_ROAD_ROUTED'].includes(saved.route.status)||saved.route.points.some(p=>p.verification==='NO_CAR_ACCESS')||!env.ROAD_ROUTING_URL)throw new Failure('ROAD_ROUTE_REQUIRED');
  const stopCount=saved.route.points.filter(p=>p.type==='SCENIC_WAYPOINT'||p.type==='DESTINATION').length;
  let result;
  try{result=await road(saved.route.points,env,false);}
  catch(e){if(e instanceof Failure)e.context={...e.context,courseId:saved.courseId};throw e;}
  const route=finish(saved.route.points,result,stopCount*(input.walking===false?600:1200),'DYNAMIC_ROUTE',['도로 연결 검증이며 명소 진입·주차는 미확인입니다.']);
  if(route.status!=='ROAD_ROUTED')throw new Failure('ROAD_ROUTE_REQUIRED');
  return {verificationStatus:'ROAD_ROUTE_VERIFIED',roadVerified:true,route,batteryStatus:battery(input,route.distanceKm),withinAvailableMinutes:input.availableMinutes==null?null:route.totalSeconds<=input.availableMinutes*60,navigationTicket:await issue(saved.courseId,route,env.NAVIGATION_TICKET_SECRET),note:'서명된 동적 코스의 좌표와 순서를 도로로 재검증했습니다. 진입·주차는 별도 확인하세요.'};
 }
 return verifySelection(saved.courseId,first.latitude,first.longitude,last.latitude,last.longitude,input,env);
}
export async function verifySelection(id:string,lat:number,lng:number,returnLat:number,returnLng:number,conditions:z.infer<typeof vehicleConditions>,env:Env){
 const course=catalog.find(c=>c.id===id);if(!course)throw new Failure('WAYPOINTS_UNAVAILABLE');
 const route=await verifyCourse(id,lat,lng,returnLat,returnLng,(15+(conditions.walking===false?0:course.walk))*60,env);
 return {verificationStatus:'ROAD_ROUTE_VERIFIED',roadVerified:true,route,batteryStatus:battery(conditions,Math.round(route.distanceKm)),withinAvailableMinutes:conditions.availableMinutes===undefined?null:Math.ceil(route.totalSeconds/60)<=conditions.availableMinutes,navigationTicket:await issue(id,route,env.NAVIGATION_TICKET_SECRET),note:'도로 스냅과 연결을 확인했습니다. 현재 통행·진입·안전 및 EV 주행 가능성은 보장하지 않습니다.'};
}
