import {mercator,elevationAt} from './terrain-model.js';
const tileCache=new Map();let manifestPromise;
const R=6378137,W=Math.PI*R;
async function manifest(){return manifestPromise??=(fetch('./terrain/tiles/manifest.json').then(r=>{if(!r.ok)throw Error('DEM_MANIFEST_UNAVAILABLE');return r.json();}));}
async function tile(key,info){
 if(!tileCache.has(key)){
  const pending=fetch('./terrain/tiles/'+info.url).then(r=>{if(!r.ok)throw Error('DEM_TILE_UNAVAILABLE');return r.json();}).then(data=>{
   const g=data.grid;if(!g||g.width<2||g.width>513||g.elevations?.length!==g.width*g.height||g.elevations.some(v=>!Number.isFinite(v)))throw Error('INVALID_DEM_TILE');return data;
  });tileCache.set(key,pending);pending.catch(()=>tileCache.delete(key));
  while(tileCache.size>8)tileCache.delete(tileCache.keys().next().value);
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
 const window=routeWindow(course),bounds=window.bounds,size=129;
 let elevations,status='AVAILABLE',capturedAt=new Date().toISOString(),spacing=(bounds[2]-bounds[0])/(size-1);
 try{
  const m=await manifest(),zoom=m.zoom??10,n=2**zoom;
  const keys=new Set(),positions=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const mx=bounds[0]+(bounds[2]-bounds[0])*x/(size-1),my=bounds[3]-(bounds[3]-bounds[1])*y/(size-1);
   const key=Math.floor((mx+W)/(2*W)*n)+'/'+Math.floor((W-my)/(2*W)*n);keys.add(key);positions.push([mx,my,key]);
  }
  if(keys.size>9||[...keys].some(k=>!m.tiles?.[k]))throw Error('DEM_COVERAGE_UNAVAILABLE');
  const tiles=new Map(await Promise.all([...keys].map(async k=>[k,await tile(k,m.tiles[k])])));
  elevations=positions.map(([x,y,k])=>Math.round(elevationAt(tiles.get(k),x,y)*10)/10);capturedAt=m.generatedAt;
 }catch{
  // Zero is only a projection plane. The renderer must not draw it as measured terrain.
  status='UNAVAILABLE';elevations=Array(size*size).fill(0);
 }
 return {version:1,courseId:course.id,capturedAt,elevationStatus:status,coverage:window.coverage,
  grid:{width:size,height:size,boundsMercator:bounds,elevations,sourceResolutionMeters:status==='AVAILABLE'?90:null,spacingGroundMeters:spacing*Math.cos(course.lat*Math.PI/180)},
  road:{coordinatesMercator:window.road,distanceMeters:(window.coverage.toKm-window.coverage.fromKm)*1000,
   anchors:[{label:'표시 구간 시작',coordinate:unproject(window.road[0])},{label:'표시 구간 끝',coordinate:unproject(window.road.at(-1))}]},
  sources:{elevation:status==='AVAILABLE'?'Copernicus GLO-90 DSM':'UNAVAILABLE',road:'OSRM / © OpenStreetMap contributors'}};
}
function unproject([x,y]){return [x/R*180/Math.PI,Math.atan(Math.sinh(y/R))*180/Math.PI];}
