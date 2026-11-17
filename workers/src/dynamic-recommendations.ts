import type {Env,Point,Route} from './types';
import {distance,Failure,hash,httpJson,httpsBase} from './utils';
import {nearby,type Poi} from './poi';
import {finish,point,roadSimplified} from './routing';
import {issue} from './tickets';
import {battery,type Input} from './recommendations';
export const dynamicPolicy=Object.freeze({candidates:20,beamWidth:14,routeChecks:5,results:5,tableMs:8000,totalMs:45000,maxSnapMeters:100,maxDetour:4});
function base(env:Env){
 if(!env.ROAD_ROUTING_URL)throw new Failure('ROAD_PROVIDER_NOT_CONFIGURED',503);
 const u=new URL(env.ROAD_ROUTING_URL);
 if(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))return u.origin;
 return httpsBase(env.ROAD_ROUTING_URL);
}
export async function matrix(points:Point[],env:Env,signal?:AbortSignal){
 const started=performance.now();let httpStatus:number|null=null,osrmCode:string|null=null;
 const fail=(reason:string,code='ROAD_TABLE_UNAVAILABLE'):never=>{
  // Never log URLs, coordinates, provider messages, request bodies or tickets.
  console.error(JSON.stringify({event:'osrm_table_failure',httpStatus,osrmCode,coordinateCount:points.length,elapsedMs:Math.round(performance.now()-started),reason}));
  throw new Failure(code,503);
 };
 const coords=points.map(p=>p.longitude+','+p.latitude).join(';');
 // POI access points are unverified discovery candidates. Ask for their snap
 // distances in the single Table call, then disconnect unsuitable candidates.
 // Origins/returns and every final Route retain the strict 100m radius.
 const url=`${base(env)}/table/v1/driving/${coords}?annotations=duration,distance&generate_hints=false&radiuses=${points.map(p=>p.type==='SCENIC_WAYPOINT'?'unlimited':dynamicPolicy.maxSnapMeters).join(';')}`;
 let response;
 try{response=await httpJson(url,{signal},dynamicPolicy.tableMs);}
 catch(e){return fail(signal?.aborted?'cancelled':e instanceof Failure&&e.code==='UPSTREAM_TIMEOUT'?'timeout':e instanceof Failure&&e.code==='RESPONSE_TOO_LARGE'?'response_too_large':'connection_failure');}
 httpStatus=response.status;
 const data=response.data as {code?:string;durations?:Array<Array<number|null>>;distances?:Array<Array<number|null>>;sources?:Array<{location:number[];distance:number}>};
 const reasons:Record<string,string>={NoSegment:'no_segment',TooBig:'table_size_limit',InvalidUrl:'invalid_request',InvalidService:'invalid_request',InvalidVersion:'invalid_request',InvalidOptions:'invalid_request',InvalidQuery:'invalid_request',InvalidValue:'invalid_request',NoTable:'no_table',NotImplemented:'unsupported_annotations',Ok:'ok'};
 osrmCode=typeof data?.code==='string'&&Object.hasOwn(reasons,data.code)?data.code:null;
 if(response.status!==200||data?.code!=='Ok')return fail(osrmCode&&osrmCode!=='Ok'?reasons[osrmCode]:data===null?'invalid_json':response.status!==200?'http_error':'invalid_response');
 for(const name of ['durations','distances'] as const){const rows=data[name];if(!Array.isArray(rows)||rows.length!==points.length||rows.some(row=>!Array.isArray(row)||row.length!==points.length||row.some(v=>v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0))))return fail('invalid_matrix','INVALID_PROVIDER_RESPONSE');}
 if(!Array.isArray(data.sources)||data.sources.length!==points.length||data.sources.some(s=>!s||!Array.isArray(s.location)||s.location.length!==2||!s.location.every(Number.isFinite)||Math.abs(s.location[0])>180||Math.abs(s.location[1])>90||!Number.isFinite(s.distance)||s.distance<0))return fail('invalid_snap','INVALID_PROVIDER_RESPONSE');
 for(let i=0;i<points.length;i++){
  const s=data.sources[i];
  if(s.distance<=dynamicPolicy.maxSnapMeters&&distance(points[i].latitude,points[i].longitude,s.location[1],s.location[0])<=.101)continue;
  if(points[i].type!=='SCENIC_WAYPOINT')return fail('snap_too_far','WAYPOINT_TOO_FAR_FROM_ROAD');
  // No estimated edges: a rejected point cannot enter any beam-search plan.
  for(const rows of [data.durations!,data.distances!])for(let j=0;j<points.length;j++){rows[i][j]=null;rows[j][i]=null;}
 }
 return {durations:data.durations!,distances:data.distances!};
}
function attraction(p:Poi){
 if(p.attractionScore!==undefined)return p.attractionScore;
 let tags:Record<string,string>={};try{tags=JSON.parse(p.attributes_json);}catch{/* quality stays conservative */}
 const scenic=p.category==='viewpoint'?85:['beach','waterfall','nature_reserve'].includes(p.category)?75:55;
 const evidence=(tags.viewpoint==='yes'?5:0)+(tags.wikipedia||tags.wikidata?5:0)+(p.description?5:0);
 return Math.min(100,scenic+evidence)*(p.quality==='NAMED_COORDINATE'?.85:.65);
}
function unsafe(r:Input,pois:Poi[],id?:string){
 const w=(id?r.courseWeather?.[id]:null)??r.weather;
 return r.originSevere||w?.severe||((w?.windMps??0)>=10&&pois.some(p=>['beach','peak','viewpoint'].includes(p.category)))||
 (w?.condition==='rainy'&&pois.some(p=>['peak','waterfall'].includes(p.category)));
}
type Plan={indices:number[];seconds:number;meters:number;score:number};
function evaluate(r:Input,stops:Poi[],seconds:number,meters:number){
 const interest=stops.reduce((sum,p)=>sum+attraction(p),0)/stops.length;
 const preference=stops.reduce((sum,p)=>sum+(r.scenery==='all'||p.scenery===r.scenery?100:30),0)/stops.length;
 const scenic=(interest*.65+preference*.35);
 const total=seconds+stops.length*(r.walking===false?600:1200);
 const time=Math.max(0,100*(1-Math.abs(total/(r.availableMinutes*60)-.82)));
 const direct=stops.reduce((s,p,i)=>s+distance(i?stops[i-1].latitude:r.latitude,i?stops[i-1].longitude:r.longitude,p.latitude,p.longitude)*1000,0);
 const efficiency=Math.min(100,direct/Math.max(1,meters)*100);
 return {score:Math.round(.35*scenic+.25*time+.2*interest+.2*efficiency),components:{scenery:scenic,time,attraction:interest,efficiency}};
}
function overlap(a:number[],b:number[]){const set=new Set(a);return b.filter(x=>set.has(x)).length/Math.max(a.length,b.length);}
export async function generate(r:Input,env:Env,signal?:AbortSignal){
 if(signal?.aborted)throw new Failure('RECOMMENDATION_CANCELLED',503);
 base(env);const started=performance.now();let poiQueries=0,tableCalls=0,routeCalls=0;
 const diagnostics=()=>({poiQueries,tableCalls,routeCalls,elapsedMs:Math.round(performance.now()-started)});
 if(unsafe(r,[]))return {courses:[],weatherExcluded:1,timeExcluded:0,routingFailed:0,status:'WEATHER_UNSAFE',guidance:'출발지의 위험 기상 조건으로 추천하지 않았습니다.',diagnostics:diagnostics()};
 let candidates:Poi[]=[];
 const initial=Math.min(100,Math.max(10,r.availableMinutes*.25));
 for(const radius of [initial,Math.min(180,initial*2),Math.min(250,initial*3)]){
  candidates=await nearby(env,r.latitude,r.longitude,radius,dynamicPolicy.candidates,r.poiIds);poiQueries++;
  if(candidates.length>=(r.poiIds?.length??6)||radius===250)break;
 }
 const empty=(status:string,guidance:string)=>({courses:[],status,guidance,weatherExcluded:0,timeExcluded:0,routingFailed:0,diagnostics:diagnostics()});
 if(!candidates.length)return empty('NO_NEARBY_POIS','주변 공개 POI 데이터가 없거나 접근 제한으로 제외됐습니다. 수집 상태와 출발지를 확인해 주세요.');
 // Dense city centres must not consume the entire matrix with adjacent parks.
 // Each annulus is still RTree bounded; only the final 20 enter OSRM Table.
 if(!r.poiIds&&r.availableMinutes>=60&&candidates.length>=6){
  const middle=await nearby(env,r.latitude,r.longitude,initial,7,undefined,initial*.25);poiQueries++;
  const outer=await nearby(env,r.latitude,r.longitude,initial,7,undefined,initial*.6);poiQueries++;
  const used=new Set<string>();
  candidates=[...candidates.slice(0,6),...middle,...outer,...candidates].filter(p=>{if(used.has(p.id))return false;used.add(p.id);return true;}).slice(0,dynamicPolicy.candidates);
 }
 candidates=candidates.filter(p=>!unsafe(r,[p]));
 for(const p of candidates)p.attractionScore=attraction(p);
 if(!candidates.length)return empty('WEATHER_UNSAFE','주변 후보가 기상 조건으로 제외됐습니다.');
 const origin=point(0,'ORIGIN','출발지',r.latitude,r.longitude);
 const stopPoints=candidates.map((p,i)=>({...point(i+1,'SCENIC_WAYPOINT',p.name,p.access_latitude,p.access_longitude),source:p.provider,verification:p.access_status,originalSnapDistanceMeters:null}));
 const returnPoint=point(stopPoints.length+1,r.roundTrip===false?'DESTINATION':'RETURN','복귀 지점',r.returnLatitude??r.latitude,r.returnLongitude??r.longitude);
 const points=[origin,...stopPoints,returnPoint];
 tableCalls++;const table=await matrix(points,env,signal);
 const end=points.length-1,roundTrip=r.roundTrip!==false;
 let beam:Plan[]=[{indices:[],seconds:0,meters:0,score:0}],plans:Plan[]=[];
 for(let depth=0;depth<3;depth++){
  const expanded:Plan[]=[];
  for(const previous of beam)for(let j=1;j<=candidates.length;j++){
   if(previous.indices.includes(j))continue;
   const from=previous.indices.at(-1)??0,d=table.durations[from][j],m=table.distances[from][j];
   const back=roundTrip?table.durations[j][end]:0,backMeters=roundTrip?table.distances[j][end]:0;
   if(d===null||m===null||back===null||backMeters===null)continue;
   if(previous.indices.some(k=>distance(points[k].latitude,points[k].longitude,points[j].latitude,points[j].longitude)<.15))continue;
   const indices=[...previous.indices,j],seconds=previous.seconds+d,meters=previous.meters+m;
   if(seconds+back+indices.length*(r.walking===false?600:1200)>r.availableMinutes*60)continue;
   const selected=indices.map(i=>candidates[i-1]);
   const score=evaluate(r,selected,seconds+back,meters+backMeters).score;
   expanded.push({indices,seconds,meters,score});
  }
  expanded.sort((a,b)=>b.score-a.score||a.meters-b.meters);
  beam=expanded.slice(0,dynamicPolicy.beamWidth);plans.push(...beam);
 }
 const unique=new Set<string>();
 plans=plans.sort((a,b)=>b.score-a.score).filter(p=>{const key=[...p.indices].sort().join(',');if(unique.has(key))return false;unique.add(key);return true;});
 if(r.poiIds)plans=plans.filter(p=>p.indices.length===r.poiIds!.length);
 const selected:Plan[]=[];
 const similarity=(a:Plan,b:Plan)=>{
  const pa=candidates[a.indices[0]-1],pb=candidates[b.indices[0]-1];
  const ax=pa.longitude-r.longitude,ay=pa.latitude-r.latitude,bx=pb.longitude-r.longitude,by=pb.latitude-r.latitude;
  const sameDirection=Math.max(0,(ax*bx+ay*by)/Math.max(.00000001,Math.hypot(ax,ay)*Math.hypot(bx,by)));
  return .75*overlap(a.indices,b.indices)+.25*sameDirection;
 };
 while(plans.length&&selected.length<dynamicPolicy.routeChecks){
  plans.sort((a,b)=>(b.score-35*Math.max(0,...selected.map(s=>similarity(b,s))))-(a.score-35*Math.max(0,...selected.map(s=>similarity(a,s)))));
  selected.push(plans.shift()!);
 }
 const courses=[];let routingFailed=0,timeExcluded=0,weatherExcluded=0;
 for(const plan of selected){
  if(signal?.aborted)throw new Failure('RECOMMENDATION_CANCELLED',503);
  const pois=plan.indices.map(i=>candidates[i-1]);
  const id='dyn-'+(await hash(pois.map(p=>p.id).join('|')+(roundTrip?'|round':'|oneway'))).slice(0,24);
  if(unsafe(r,pois,id)){weatherExcluded++;continue;}
  const routePoints:Point[]=[{...origin},...plan.indices.map(i=>({...points[i]}))];
  if(roundTrip)routePoints.push({...returnPoint});
  else routePoints[routePoints.length-1]={...routePoints.at(-1)!,type:'DESTINATION'};
  routePoints.forEach((p,i)=>p.order=i);
  let route:Route;
  try{
   routeCalls++;
   route=finish(routePoints,await roadSimplified(routePoints,env,signal),pois.length*(r.walking===false?600:1200),'DYNAMIC_ROUTE',[
    'OSM 도로 연결 검증이며 현재 통행·명소 진입·주차 가능성을 보장하지 않습니다.',
    '공개 POI 유형과 메타데이터 기반 점수는 경관 품질 실측이 아닙니다.'
   ]);
  }catch{routingFailed++;continue;}
  if(route.status!=='ROAD_ROUTED'){routingFailed++;continue;}
  if(route.totalSeconds>r.availableMinutes*60){timeExcluded++;continue;}
  const direct=routePoints.slice(1).reduce((s,p,i)=>s+distance(routePoints[i].latitude,routePoints[i].longitude,p.latitude,p.longitude),0);
  if(route.distanceKm>Math.max(10,direct*dynamicPolicy.maxDetour)){routingFailed++;continue;}
  const evaluation=evaluate(r,pois,route.drivingSeconds,route.distanceKm*1000);
  const status=battery(r,route.distanceKm);
  const warnings=status==='CHARGING_MAY_BE_NEEDED'?['입력 배터리 기준 충전이 필요할 수 있어요. 검증된 충전소는 제공하지 않습니다.']:[];
  const sources=[...new Set(pois.map(p=>p.provider))];
  courses.push({id,name:pois.map(p=>p.name).join(' · '),description:`${pois.length}개 공개 명소를 잇는 ${roundTrip?'왕복':'편도'} 드라이브`,scenery:pois[0].scenery,region:pois[0].region,
   latitude:pois[0].latitude,longitude:pois[0].longitude,score:evaluation.score,scoreComponents:evaluation.components,scoreStatus:'METADATA_ESTIMATE',
   reasons:['주변 POI와 실제 도로 이동시간으로 구성했어요.',`정차 ${route.stopSeconds/60}분을 별도로 반영했어요.`,...warnings],
   estimatedRoundTripKm:route.distanceKm,estimatedMinutes:Math.ceil(route.totalSeconds/60),drivingMinutes:Math.ceil(route.drivingSeconds/60),stopMinutes:route.stopSeconds/60,
   waypoints:pois.map(p=>({id:p.id,name:p.name,latitude:p.latitude,longitude:p.longitude,accessLatitude:p.access_latitude,accessLongitude:p.access_longitude,accessStatus:p.access_status,accessKind:p.access_kind,description:p.description??'',source:p.provider,sourceUpdatedAt:p.source_updated_at})),
   distanceTimeStatus:route.status,batteryStatus:status,vehicleTransferAllowed:true,vehicleTransferCondition:'EXPLICIT_USER_APPROVAL_AND_VEHICLE_PREVIEW_REQUIRED',
   dataSource:{course:sources.join(' + '),distanceTime:route.provider,weather:(r.courseWeather?.[id]??r.weather)?.source??'예시 날씨',weatherObservedAt:(r.courseWeather?.[id]??r.weather)?.observedAt??null,generatedAt:route.generatedAt,attribution:'© OpenStreetMap contributors (ODbL); 한국관광공사 TourAPI (해당 자료)'},
   route,navigationTicket:await issue(id,route,env.NAVIGATION_TICKET_SECRET)});
 }
 return {courses,weatherExcluded,timeExcluded,routingFailed,status:courses.length?'ROAD_ROUTED':routingFailed?'ROAD_PROVIDER_UNAVAILABLE':'NO_FEASIBLE_ROUTE',guidance:courses.length?'실제 도로 연결을 확인한 동적 코스입니다. 명소 진입·주차는 별도 확인하세요.':'조건을 충족하는 도로 코스를 만들지 못했습니다. 시간을 늘리거나 잠시 후 재시도하세요.',diagnostics:diagnostics()};
}
