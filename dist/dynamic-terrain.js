import {detailAreas} from './terrain-detail.js';
import {mercator,elevationAt} from './terrain-model.js';
import {actualRoadPoints} from './course-preview.js';
const tileCache=new Map(),pendingTiles=new Set();let manifestPromise;
const R=6378137,W=Math.PI*R;
async function readJson(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const r=await fetch(new URL(path,import.meta.url),{signal:controller.signal});if(!r.ok)throw Error('TERRAIN_UNAVAILABLE');return await r.json();}finally{clearTimeout(timer);}}
async function manifest(){if(!manifestPromise){const pending=readJson('./terrain/tiles/manifest.json');manifestPromise=pending;pending.catch(()=>{if(manifestPromise===pending)manifestPromise=null;});}return manifestPromise;}
function trimTiles(){while(tileCache.size>8){const key=[...tileCache.keys()].find(k=>!pendingTiles.has(k));if(key===undefined)break;tileCache.delete(key);}}
export function retryTerrainData(){manifestPromise=null;}
async function tile(key,info){
 if(!tileCache.has(key)){
  if(!/^\d+\/\d+\/\d+\.json$/.test(info.url))throw Error('INVALID_DEM_URL');
  const pending=readJson('./terrain/tiles/'+info.url).then(data=>{
   const g=data.grid,b=g?.boundsMercator;if(!g||!Number.isInteger(g.width)||!Number.isInteger(g.height)||g.width<2||g.height<2||g.width>513||g.height>513||!Array.isArray(g.elevations)||g.elevations.length!==g.width*g.height||g.elevations.some(v=>!Number.isFinite(v))||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]>=b[2]||b[1]>=b[3])throw Error('INVALID_DEM_TILE');return data;
  });tileCache.set(key,pending);pendingTiles.add(key);pending.then(()=>{pendingTiles.delete(key);trimTiles();},()=>{pendingTiles.delete(key);if(tileCache.get(key)===pending)tileCache.delete(key);});
  trimTiles();
 }
 return tileCache.get(key);
}
export function routeWindow(course,maxKm=20){
 const raw=course.route?.legs?.flatMap(l=>l.geometry??[])??[];
 if(raw.length<2||raw.length>100000||raw.some(p=>!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)))throw Error('ROAD_GEOMETRY_UNAVAILABLE');
 const projected=raw.map(p=>mercator(p.longitude,p.latitude));
 const lengths=[0];for(let i=1;i<raw.length;i++){
  const a=raw[i-1],b=raw[i],scale=Math.cos((a.latitude+b.latitude)/2*Math.PI/180);
  lengths.push(lengths.at(-1)+Math.hypot(projected[i][0]-projected[i-1][0],projected[i][1]-projected[i-1][1])*scale);
 }
 const total=lengths.at(-1),start=Math.max(0,total*.4-maxKm*1000*.5),end=Math.min(total,start+maxKm*1000);
 const at=position=>{let i=lengths.findIndex(x=>x>=position);if(i<=0)return projected[0];const fraction=(position-lengths[i-1])/Math.max(.001,lengths[i]-lengths[i-1]);return projected[i].map((value,j)=>projected[i-1][j]+(value-projected[i-1][j])*fraction);};
 const road=[at(start),...projected.filter((_,i)=>lengths[i]>start&&lengths[i]<end),at(end)],step=Math.max(1,Math.ceil(road.length/3000));
 const sampled=road.filter((_,i)=>i%step===0||i===road.length-1);
 const xs=sampled.map(p=>p[0]),ys=sampled.map(p=>p[1]),padding=1000;
 return {road:sampled,bounds:[Math.min(...xs)-padding,Math.min(...ys)-padding,Math.max(...xs)+padding,Math.max(...ys)+padding],
  coverage:{kind:total>maxKm*1000?'HIGHLIGHT_SEGMENT':'FULL_ROUTE',fromKm:start/1000,toKm:end/1000,totalKm:total/1000}};
}
export async function dynamicTerrain(course){
 const verified=actualRoadPoints(course).length>1;
 const window=verified?routeWindow(course):poiWindow(course),bounds=window.bounds,size=129;
 let elevations,validity,status='AVAILABLE',capturedAt=new Date().toISOString(),spacing=(bounds[2]-bounds[0])/(size-1);
 try{
  const m=await manifest(),zoom=m.zoom??10,n=2**zoom;
  const keys=new Set(),positions=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const mx=bounds[0]+(bounds[2]-bounds[0])*x/(size-1),my=bounds[3]-(bounds[3]-bounds[1])*y/(size-1);
   const key=Math.floor((mx+W)/(2*W)*n)+'/'+Math.floor((W-my)/(2*W)*n);keys.add(key);positions.push([mx,my,key]);
  }
  if(keys.size>9)throw Error('DEM_COVERAGE_UNAVAILABLE');
  const loaded=await Promise.allSettled([...keys].filter(k=>m.tiles?.[k]).map(async k=>[k,await tile(k,m.tiles[k])]));
  const tiles=new Map(loaded.filter(r=>r.status==='fulfilled').map(r=>r.value));
  const areas=detailAreas.filter(({bounds:b})=>b[0]<bounds[2]&&b[2]>bounds[0]&&b[1]<bounds[3]&&b[3]>bounds[1]);
  const captures=(await Promise.allSettled(areas.map(({id})=>readJson('./terrain/'+id+'.json'))))
   .flatMap(r=>r.status==='fulfilled'&&r.value.courseId&&r.value.grid?.boundsMercator?[r.value]:[]);
  const sources=positions.map(([x,y,key])=>captures.find(({grid:{boundsMercator:b}})=>x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3])??tiles.get(key));
  validity=sources.map(Boolean);
  if(!validity.some(Boolean))throw Error('DEM_COVERAGE_UNAVAILABLE');
  status=validity.every(Boolean)?'AVAILABLE':'PARTIAL';
  // Missing samples are masked out by the renderer, never filled with invented terrain.
  elevations=positions.map(([x,y],i)=>sources[i]?Math.round(elevationAt(sources[i],x,y)*10)/10:0);capturedAt=m.generatedAt;
 }catch{
  // Zero is only a projection plane. The renderer must not draw it as measured terrain.
  status='UNAVAILABLE';validity=undefined;elevations=Array(size*size).fill(0);
 }
 return {version:1,courseId:course.id,capturedAt,elevationStatus:status,coverage:window.coverage,previewKind:verified?'ROAD':'POI_AREA',roadVerified:course.route?.status==='ROAD_ROUTED',roadGeometryAvailable:verified,
  grid:{width:size,height:size,boundsMercator:bounds,elevations,validity,sourceResolutionMeters:status!=='UNAVAILABLE'?90:null,spacingGroundMeters:spacing*Math.cos(course.lat*Math.PI/180)},
  road:{coordinatesMercator:window.road,distanceMeters:(window.coverage.toKm-window.coverage.fromKm)*1000,
   anchors:window.anchors??[{label:'표시 구간 시작',coordinate:unproject(window.road[0])},{label:'표시 구간 끝',coordinate:unproject(window.road.at(-1))}]},
  sources:{elevation:status!=='UNAVAILABLE'?'Copernicus GLO-90 DSM':'UNAVAILABLE',road:verified?'OSRM / © OpenStreetMap contributors':'PUBLIC_POI_LOCATIONS'}};
}
export function poiWindow(course){
 const points=(course.route?.points??[]).filter(p=>['SCENIC_WAYPOINT','DESTINATION'].includes(p.type)&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
 if(!points.length)throw Error('WAYPOINTS_UNAVAILABLE');
 const projected=points.map(p=>mercator(p.longitude,p.latitude)),cos=Math.cos(points.reduce((s,p)=>s+p.latitude,0)/points.length*Math.PI/180);
 const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]),mean=[xs.reduce((a,b)=>a+b)/xs.length,ys.reduce((a,b)=>a+b)/ys.length];
 let indices=points.map((_,i)=>i);
 if(Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))*cos>18000){
  const clusters=projected.map((center,i)=>({indices:projected.map((p,j)=>Math.hypot(p[0]-center[0],p[1]-center[1])*cos<=9000?j:-1).filter(j=>j>=0),distance:Math.hypot(center[0]-mean[0],center[1]-mean[1]),i}));
  clusters.sort((a,b)=>b.indices.length-a.indices.length||a.distance-b.distance||a.i-b.i);indices=clusters[0].indices;
 }
 const anchors=indices.map(i=>({label:points[i].name,order:points[i].order??i+1,coordinate:[points[i].longitude,points[i].latitude]})),road=indices.map(i=>projected[i]);
 const px=road.map(p=>p[0]),py=road.map(p=>p[1]),padding=(indices.length===1?1800:850)/cos,bounds=[Math.min(...px)-padding,Math.min(...py)-padding,Math.max(...px)+padding,Math.max(...py)+padding];
 return {bounds,road,anchors,coverage:{kind:'POI_AREA',fromKm:0,toKm:0,totalKm:0,shownStops:anchors.length,totalStops:points.length,representative:anchors.length<points.length}};
}
function unproject([x,y]){return [x/R*180/Math.PI,Math.atan(Math.sinh(y/R))*180/Math.PI];}
