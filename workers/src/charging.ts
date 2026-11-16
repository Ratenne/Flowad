import { Hono } from 'hono';
import type { Bindings } from './types';
import { Failure } from './utils';
export const charging=new Hono<Bindings>();
charging.post('/recommendations',async c=>{
  const raw:unknown=await c.req.json().catch(()=>null);
  const input=raw as {routeStatus?:unknown;geometry?:unknown}|null;
  if(!input||input.routeStatus!=='ROAD_ROUTED'||!Array.isArray(input.geometry)||input.geometry.length<2)return c.json({status:'ROAD_ROUTE_REQUIRED',stations:[],note:'실제 도로 경로가 필요합니다.'});
  if(input.geometry.length>20000)throw new Failure('INVALID_REQUEST');
  if(c.env.FREE_PLAN_MODE==='true'&&input.geometry.length>2000)throw new Failure('GEOMETRY_LIMIT_EXCEEDED',413);
  // Validate without cloning a large array twice. Compare haversines directly;
  // atan2/sqrt are needed only once per station, after finding the nearest point.
  const sources=[{name:'모의 충전소 A',latitude:37.56,longitude:127},{name:'모의 충전소 B',latitude:37.74,longitude:127.4}];
  const rad=Math.PI/180,nearest=sources.map(()=>Infinity),cos=sources.map(s=>Math.cos(s.latitude*rad));
  const radius=15/6371,latitudeBound=radius/rad+1e-9,radiusV=Math.sin(radius/2)**2;
  const latitudeBounds=sources.map(()=>latitudeBound);
  const longitudeBounds=sources.map((s,i)=>{
    const minimumCos=Math.cos(Math.min(Math.PI/2,Math.abs(s.latitude*rad)+radius));
    return minimumCos>0?2*Math.asin(Math.min(1,Math.sqrt(radiusV/(minimumCos*cos[i]))))/rad+1e-9:180;
  });
  for(const value of input.geometry){
    if(!value||typeof value!=='object')throw new Failure('INVALID_REQUEST');
    const p=value as {latitude?:unknown;longitude?:unknown},lat=p.latitude,lon=p.longitude;
    if(typeof lat!=='number'||typeof lon!=='number'||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Failure('INVALID_REQUEST');
    let latitudeCos:number|undefined;
    for(let i=0;i<sources.length;i++){
      const station=sources[i];
      // Conservative spherical bounds: excluded points cannot be within 15km.
      // This changes no returned proximity and avoids unnecessary trigonometry.
      const delta=Math.abs(station.longitude-lon);
      if(Math.abs(station.latitude-lat)>latitudeBounds[i]||Math.min(delta,360-delta)>longitudeBounds[i])continue;
      latitudeCos??=Math.cos(lat*rad);
      const v=Math.sin((station.latitude-lat)*rad/2)**2+latitudeCos*cos[i]*Math.sin((station.longitude-lon)*rad/2)**2;
      if(v<nearest[i]){
        nearest[i]=v;
        latitudeBounds[i]=Math.min(latitudeBound,2*Math.asin(Math.min(1,Math.sqrt(v)))/rad+1e-9);
      }
    }
  }
  const stations=[];
  for(let i=0;i<sources.length;i++){
    const km=12742*Math.atan2(Math.sqrt(nearest[i]),Math.sqrt(Math.max(0,1-nearest[i])));
    if(km<=15)stations.push({name:sources[i].name,source:'MOCK_FICTITIOUS',connector:'미확인',output:'미확인',availability:'미확인',compatibility:'미확인',detour:'미확인',straightLineProximity:`경로 좌표와 직선거리 약 ${Math.round(km)}km (이탈거리 아님)`});
  }
  return c.json({status:'MOCK_ONLY',stations,note:'실존 충전소가 아닌 테스트 데이터입니다. 실제 운행에 사용할 수 없습니다.'});
});
