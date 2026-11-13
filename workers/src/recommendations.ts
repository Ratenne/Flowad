import { z } from 'zod';
import catalog from '../../backend/src/main/resources/courses.json';
import type { Env, Route } from './types';
import { coordinate, distance, Failure } from './utils';
import { route } from './routing';
import { issue } from './tickets';
import { batchRoutes } from './batch-routing';
const weather=z.object({condition:z.enum(['sunny','cloudy','rainy']),temperatureC:z.number(),windMps:z.number().min(0),severe:z.boolean().nullish(),source:z.string().min(1).max(100).refine(s=>s.trim().length>0),observedAt:z.iso.datetime({offset:true}).nullish()});
export const recommendation=coordinate.extend({availableMinutes:z.number().int().min(1).max(1440),scenery:z.enum(['all','forest','coast','open']),vehicleType:z.enum(['ice','ev']),batteryPercent:z.number().min(0).max(100).nullish(),estimatedRangeKm:z.number().positive().max(2000).nullish(),weather:weather.nullish(),courseWeather:z.record(z.string(),weather.nullable()).refine(x=>Object.keys(x).length<=10).nullish(),originSevere:z.boolean().nullish(),walking:z.boolean().nullish(),departure:z.string().nullish(),returnLatitude:z.number().min(-90).max(90).nullish(),returnLongitude:z.number().min(-180).max(180).nullish()}).refine(r=>(r.returnLatitude==null)===(r.returnLongitude==null));
type Input=z.infer<typeof recommendation>;
export function battery(r: {vehicleType:string;batteryPercent?:number|null;estimatedRangeKm?:number|null},km: number) {return r.vehicleType!=='ev'?'NOT_APPLICABLE':r.batteryPercent==null||r.estimatedRangeKm==null?'INSUFFICIENT_INPUT':r.batteryPercent-km*1.2/r.estimatedRangeKm*100<15?'CHARGING_MAY_BE_NEEDED':'ESTIMATED_SUFFICIENT';}
function excluded(r:Input,c:typeof catalog[number]){const w=r.courseWeather?.[c.id]??r.weather;return !!(r.originSevere||w?.severe||((w?.windMps??2)>=10&&c.exposure>=.7)||((w?.condition??'sunny')==='rainy'&&c.altitude>.6));}
export async function recommend(r: Input, env: Env) {
  // Final service policy: recommendations never require a road provider. Keep
  // the original ten-candidate estimates; road validation is a selected action.
  return recommendWithRouting(r,{...env,ROAD_ROUTING_URL:undefined,OSRM_BATCH_URL:undefined});
}
// Retained only for reproducing the earlier routing/batch experiments.
export async function recommendWithRouting(r: Input, env: Env) {
  type Candidate={course:typeof catalog[number];km:number;minutes:number;score:number;weather:Input['weather'];route:Route};
  const candidates:Candidate[]=[]; let weatherExcluded=0,timeExcluded=0,routingFailed=0;
  // Only explicit summary-mode experiments use batch. Full-geometry consumers,
  // including Tesla destination validation, retain the original road client.
  const batched=env.OSRM_BATCH_URL&&env.ROAD_ROUTING_URL&&env.FREE_PLAN_MODE==='true'
    ?await batchRoutes(catalog.filter(c=>!excluded(r,c)).map(c=>({id:c.id,stops:15+(r.walking===false?0:c.walk)})),r,env):undefined;
  for(const c of catalog){
    const approach=distance(r.latitude,r.longitude,c.lat,c.lng),w=r.courseWeather?.[c.id]??r.weather;
    const temp=w?.temperatureC??22,wind=w?.windMps??2,condition=w?.condition??'sunny';
    if(excluded(r,c)){weatherExcluded++;continue;}
    let result:Route;
    try{if(batched){const value=batched.get(c.id);if(value instanceof Failure)throw value;if(!value)throw new Failure('INVALID_PROVIDER_RESPONSE');result=value;}else result=await route(c.id,r.latitude,r.longitude,r.returnLatitude??r.latitude,r.returnLongitude??r.longitude,15+(r.walking===false?0:c.walk),env);}
    catch(e){routingFailed++;if(e instanceof Failure&&['PROVIDER_UNAVAILABLE','PROVIDER_PERMISSION_DENIED','RATE_LIMIT'].includes(e.code))break;continue;}
    const km=Math.round(result.distanceKm),minutes=Math.ceil(result.totalSeconds/60);
    if(minutes>r.availableMinutes){timeExcluded++;continue;}
    let ws=condition==='sunny'?(temp>=28?.25+.7*c.shade:temp<8?.8-.4*c.exposure-.2*c.altitude:.96-.15*c.shade):condition==='cloudy'?.9-.12*c.altitude:.75-.3*c.altitude-.15*c.exposure;
    ws=Math.max(.05,ws-wind/16*c.exposure*.5);
    const scenery=temp>=28?c.shade:temp<8?1-c.altitude:condition==='sunny'?.8+c.exposure*.2:.8;
    const preference=r.scenery==='all'?.83:c.mood===r.scenery?1:.24,ease=c.ease*(battery(r,km)==='CHARGING_MAY_BE_NEEDED'?.78:1);
    const score=Math.round(Math.min(.99,ws*.35+scenery*.25+preference*.2+(ease*.5+Math.max(.3,1-approach/180)*.5)*.1+c.novelty*.1+(r.departure==='sunset'&&c.scene!=='forest'?.04:0))*100);
    candidates.push({course:c,km,minutes,score,weather:w,route:result});
  }
  candidates.sort((a,b)=>b.score-a.score||a.km-b.km);
  const moods=new Set<string>(),courses=[];
  while(candidates.length&&courses.length<3){candidates.sort((a,b)=>(b.score-(moods.has(b.course.mood)?7:0))-(a.score-(moods.has(a.course.mood)?7:0)));const x=candidates.shift()!;moods.add(x.course.mood);
    const real=x.route.status==='ROAD_ROUTED',bs=r.vehicleType==='ev'&&!real?'ROAD_ROUTE_REQUIRED':battery(r,x.km);
    const reasons=[real?'출발지와 왕복 가능 시간을 기준으로 계산했어요.':'출발지와 왕복 가능 시간을 기준으로 추정했어요.'];
    if(r.scenery!=='all'&&r.scenery===x.course.mood)reasons.push('선택한 풍경 취향을 반영했어요.');
    if(x.weather)reasons.push('제공된 날씨 조건을 반영했어요.');
    if(bs==='ROAD_ROUTE_REQUIRED')reasons.push('실제 도로 경로가 없어 충전 필요성을 판단할 수 없어요.');
    else if(bs==='INSUFFICIENT_INPUT')reasons.push('배터리 판단에 필요한 입력이 부족해요.');
    else if(bs==='CHARGING_MAY_BE_NEEDED')reasons.push('입력값 기준 충전이 필요할 수 있어요.');
    courses.push({id:x.course.id,name:x.course.name,reasons,estimatedRoundTripKm:x.km,estimatedMinutes:x.minutes,waypoints:x.route.points.map(p=>({name:p.name,description:p.verification})),distanceTimeStatus:x.route.status,batteryStatus:bs,dataSource:{course:'내장 예시 코스 10개',distanceTime:real?x.route.provider:'각 구간 직선거리 × 1.18 및 평균 55km/h 추정',weather:x.weather?.source??'없음: 예시 날씨',weatherObservedAt:x.weather?.observedAt??null,generatedAt:new Date().toISOString()},route:x.route,navigationTicket:await issue(x.course.id,x.route,env.NAVIGATION_TICKET_SECRET)});
  }
  return {courses,weatherExcluded,timeExcluded,routingFailed,guidance:!courses.length?(routingFailed?'경로 계산에 실패한 후보가 있습니다. 잠시 후 다시 시도하거나 조건을 조정하세요.':'조건에 맞는 코스가 없습니다. 이용 시간을 늘리거나 날씨 조건을 확인하세요.'):courses.every(c=>c.route.status==='ROAD_ROUTED')?'도로 경로 기준 추천입니다.':'차량 순정 내비의 경로 결과를 받기 전이라 전체 왕복은 추정입니다.'};
}
