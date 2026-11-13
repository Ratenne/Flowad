import anchorsData from '../../backend/src/main/resources/anchors.json';
import type { Env, Leg, Point, Route } from './types';
import { coordinate, distance, Failure, httpJson, httpsBase, round } from './utils';
const anchors: Record<string, {capturedAt: string; anchors: {label: string; coordinate: number[]; snap_distance_m: number}[]}> = anchorsData;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Failure('INVALID_PROVIDER_RESPONSE');return value as Record<string,unknown>;}
function number(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value))throw new Failure('INVALID_PROVIDER_RESPONSE');return value;}
function xy(value:unknown):[number,number]{if(!Array.isArray(value)||value.length!==2)throw new Failure('INVALID_PROVIDER_RESPONSE');const lon=number(value[0]),lat=number(value[1]);if(Math.abs(lon)>180||Math.abs(lat)>90)throw new Failure('INVALID_PROVIDER_RESPONSE');return value as [number,number];}
export function point(order: number, type: string, name: string, latitude: number, longitude: number): Point {
  coordinate.parse({latitude,longitude});
  return { order, type, name, latitude, longitude, source: 'USER_INPUT', verification: 'NOT_VERIFIED', originalSnapDistanceMeters: null };
}
export async function road(points: Point[], env: Env, includeGeometry=env.FREE_PLAN_MODE!=='true'): Promise<Pick<Route,'legs'|'status'|'provider'|'geometryStatus'>> {
  if (!env.ROAD_ROUTING_URL) {
    const legs = points.slice(1).map((b,i) => {const a=points[i], km=distance(a.latitude,a.longitude,b.latitude,b.longitude)*1.18;return {fromOrder:i,toOrder:i+1,distanceKm:round(km,2),durationSeconds:Math.ceil(km/55*3600),geometry:null};});
    return { legs, status:'ESTIMATED_NOT_ROAD_ROUTED',provider:'mock-straight-line',geometryStatus:'NOT_AVAILABLE' };
  }
  const coords = points.map(p=>`${p.longitude},${p.latitude}`).join(';');
  const response=await requestRoad(points,env,includeGeometry,coords);
  return roadResponse(points,response,includeGeometry);
}
async function requestRoad(points:Point[],env:Env,includeGeometry:boolean,coords=points.map(p=>`${p.longitude},${p.latitude}`).join(';')){
  if(!env.ROAD_ROUTING_URL)throw new Failure('ROAD_ROUTE_REQUIRED');
  let response;
  try { response = await httpJson(`${httpsBase(env.ROAD_ROUTING_URL)}/route/v1/driving/${coords}?steps=${includeGeometry}&geometries=geojson&overview=false&generate_hints=false&radiuses=${points.map(()=>100).join(';')}`,{},8000); }
  catch { throw new Failure('PROVIDER_UNAVAILABLE'); }
  return response;
}
export function roadResponse(points:Point[],response:{status:number;data:unknown},includeGeometry:boolean):Pick<Route,'legs'|'status'|'provider'|'geometryStatus'> {
  if(response.status===429)throw new Failure('RATE_LIMIT');
  if(response.status===403)throw new Failure('PROVIDER_PERMISSION_DENIED');
  if(response.status===400){const code=object(response.data).code;throw new Failure(code==='NoSegment'?'WAYPOINT_TOO_FAR_FROM_ROAD':code==='NoRoute'?'NO_ROAD_ROUTE':'INVALID_PROVIDER_RESPONSE');}
  if(response.status!==200)throw new Failure('PROVIDER_UNAVAILABLE');
  // Validate the provider stream's parsed objects in one pass. Avoid cloning every
  // tuple through nested schemas before constructing the public leg geometry.
  const root=object(response.data);if(root.code!=='Ok')throw new Failure('NO_ROAD_ROUTE');
  if(!Array.isArray(root.routes)||!root.routes.length||!Array.isArray(root.waypoints))throw new Failure('INVALID_PROVIDER_RESPONSE');
  const raw=object(root.routes[0]).legs;
  if(!Array.isArray(raw)||root.waypoints.length!==points.length||raw.length!==points.length-1)throw new Failure('INCOMPLETE_ROUTE');
  root.waypoints.forEach((value,i)=>{const w=object(value),location=xy(w.location),snap=number(w.distance);if(snap<0||snap>100||distance(location[1],location[0],points[i].latitude,points[i].longitude)>.101)throw new Failure('WAYPOINT_TOO_FAR_FROM_ROAD');});
  const legs: Leg[]=raw.map((value,i)=>{
    const l=object(value),meters=number(l.distance),seconds=number(l.duration);
    if(meters<=0||seconds<=0||seconds>2147483647)throw new Failure('INVALID_PROVIDER_RESPONSE');
    if(!includeGeometry)return {fromOrder:i,toOrder:i+1,distanceKm:meters/1000,durationSeconds:Math.ceil(seconds),geometry:null};
    if(!Array.isArray(l.steps))throw new Failure('INVALID_PROVIDER_RESPONSE');
    const geometry:{latitude:number;longitude:number}[]=[];
    for(const step of l.steps){const coordinates=object(object(step).geometry).coordinates;if(!Array.isArray(coordinates))throw new Failure('INVALID_PROVIDER_RESPONSE');for(const value of coordinates){const c=xy(value);geometry.push({latitude:c[1],longitude:c[0]});if(geometry.length>20000)throw new Failure('INCOMPLETE_ROUTE');}}
    if(geometry.length<2 || geometry.length>20000)throw new Failure('INCOMPLETE_ROUTE');
    const first=geometry[0],last=geometry.at(-1)!;
    if(distance(first.latitude,first.longitude,points[i].latitude,points[i].longitude)>.15||distance(last.latitude,last.longitude,points[i+1].latitude,points[i+1].longitude)>.15)throw new Failure('INCOMPLETE_ROUTE');
    return {fromOrder:i,toOrder:i+1,distanceKm:meters/1000,durationSeconds:Math.ceil(seconds),geometry};
  });
  return {legs,status:'ROAD_ROUTED',provider:'OSRM / OpenStreetMap',geometryStatus:includeGeometry?'PROVIDER_GEOMETRY':'NOT_REQUESTED_FREE_PLAN'};
}
export async function route(id: string, lat: number, lng: number, returnLat: number, returnLng: number, stops: number, env: Env): Promise<Route> {
  const {points,warnings}=routePoints(id,lat,lng,returnLat,returnLng);
  return finish(points,await road(points,env),stops*60,'HIGHLIGHT_ONLY',warnings);
}
export function routePoints(id:string,lat:number,lng:number,returnLat:number,returnLng:number) {
  const course=anchors[id]; if(!course)throw new Failure('WAYPOINTS_UNAVAILABLE');
  const points=[point(0,'ORIGIN','출발지',lat,lng)],warnings:string[]=[];
  for(const a of course.anchors){const far=a.snap_distance_m>500;if(far)warnings.push('과거 도로 스냅 거리가 500m를 넘는 경유지가 있어 진입이 불확실합니다.');points.push({...point(points.length,'SCENIC_WAYPOINT',a.label,a.coordinate[1],a.coordinate[0]),source:`OSRM/OSM 스냅 (${course.capturedAt})`,verification:far?'HISTORICAL_SNAP_FAR_ACCESS_UNCERTAIN':'HISTORICAL_SNAP_ACCESS_UNVERIFIED',originalSnapDistanceMeters:a.snap_distance_m});}
  points.push(point(points.length,'RETURN','복귀 지점',returnLat,returnLng));
  for(let i=1;i<points.length;i++)if(distance(points[i-1].latitude,points[i-1].longitude,points[i].latitude,points[i].longitude)<.001)throw new Failure('DUPLICATE_ADJACENT_POINTS');
  warnings.push('경유지와 출발·복귀 지점의 현재 진입 가능 여부는 확인되지 않았습니다.');
  return {points,warnings};
}
export async function verifyCourse(id:string,lat:number,lng:number,returnLat:number,returnLng:number,stopSeconds:number,env:Env):Promise<Route>{
  const {points,warnings}=routePoints(id,lat,lng,returnLat,returnLng);
  const response=await requestRoad(points,env,false),result=roadResponse(points,response,false);
  // roadResponse already validates every location, radius, leg count and value.
  const waypoints=(response.data as {waypoints:{location:[number,number]}[]}).waypoints;
  const snapped=points.map((p,i)=>({...p,latitude:waypoints[i].location[1],longitude:waypoints[i].location[0],source:'OSRM / OpenStreetMap',verification:'PROVIDER_SNAP_ACCESS_UNVERIFIED'}));
  warnings.push('도로 연결 검증은 현재 통행·진입 가능성과 안전을 보장하지 않습니다.');
  return finish(snapped,result,stopSeconds,'HIGHLIGHT_ONLY',warnings);
}
export function finish(points: Point[], result: Awaited<ReturnType<typeof road>>, stopSeconds: number, terrainStatus: string, warnings: string[]): Route {
  const drivingSeconds=result.legs.reduce((s,l)=>s+l.durationSeconds,0);
  if(drivingSeconds+stopSeconds>2147483647)throw new Failure('INVALID_PROVIDER_RESPONSE');
  if(result.geometryStatus==='NOT_REQUESTED_FREE_PLAN')warnings.push('무료 운영 모드에서는 전체 왕복 도로선을 요청하지 않습니다. 거리·시간은 실제 도로 제공자 응답입니다.');
  return {...result,points,distanceKm:round(result.legs.reduce((s,l)=>s+l.distanceKm,0),1),drivingSeconds,stopSeconds,totalSeconds:drivingSeconds+stopSeconds,terrainStatus,warnings,generatedAt:new Date().toISOString()};
}
export async function destination(name: string, lat: number, lng: number, originLat: number, originLng: number, env: Env) {
  const points=[point(0,'ORIGIN','도로 검증 출발 기준점',originLat,originLng),point(1,'DESTINATION',name,lat,lng)],result=await road(points,env,true);
  if(result.status!=='ROAD_ROUTED')throw new Failure('ROAD_ROUTE_REQUIRED');
  return finish(points,result,0,'UNAVAILABLE',['OSM 도로 연결 검증이며 현재 통행 가능 여부는 미확인입니다.','Tesla는 차량 현재 위치에서 경로를 다시 계산합니다.']);
}
