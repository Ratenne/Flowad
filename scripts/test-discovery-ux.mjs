import assert from 'node:assert/strict';
import {poiWindow,dynamicTerrain,retryTerrainData} from '../dist/dynamic-terrain.js';
import {mercator,makeTerrainModel,makeLatestTerrainLoader,hasElevation} from '../dist/terrain-model.js';
import {actualRoadPoints,previewMarkup} from '../dist/course-preview.js';
import {connectionSection} from '../dist/ux-presentation.js';
const point=(name,latitude,longitude,type='SCENIC_WAYPOINT')=>({name,latitude,longitude,type});
const course=(points,status='ESTIMATED_NOT_ROAD_ROUTED')=>({id:'dyn-ux',name:'비교 코스',lat:points[0].latitude,route:{status,points,legs:[],generatedAt:'test'}});
const local=course([point('숲길',37.5,127),point('전망대',37.53,127.03),point('호수',37.55,127.02)]);
const area=poiWindow(local);assert.equal(area.anchors.length,3);assert.equal(area.coverage.representative,false);
for(const p of local.route.points){const [x,y]=mercator(p.longitude,p.latitude);assert.ok(x>=area.bounds[0]&&x<=area.bounds[2]&&y>=area.bounds[1]&&y<=area.bounds[3]);}
const distant=course([point('먼 해안',35.1,129),point('숲길',37.5,127),point('전망대',37.52,127.02)]),representative=poiWindow(distant);
assert.equal(representative.coverage.representative,true);assert.deepEqual(representative.anchors.map(a=>a.order),[2,3]);assert.ok(previewMarkup(distant).includes('먼 해안'),'All stops remain in the full 2D view');
const verified=course(local.route.points,'ROAD_ROUTED');assert.deepEqual(actualRoadPoints(verified),[]);assert.match(previewMarkup(verified),/stroke-dasharray/,'Road verification without geometry is still a stop sketch');
const geometry=local.route.points.slice(0,2);verified.route.legs=[{geometry}];assert.equal(actualRoadPoints(verified).length,2);assert.doesNotMatch(previewMarkup(verified),/stroke-dasharray/);
assert.match(previewMarkup({...local,name:'<script>alert(1)</script>'}),/&lt;script&gt;/);assert.doesNotMatch(previewMarkup({...local,name:'<script>alert(1)</script>'}),/<script>/);
const originalFetch=globalThis.fetch,calls=[];const W=Math.PI*6378137;
// Synthetic DEM fixture only: never exported as production terrain.
globalThis.fetch=async url=>{calls.push(String(url));return Response.json(String(url).endsWith('manifest.json')?{zoom:0,generatedAt:'TEST',tiles:{'0/0':{url:'0/0/0.json'}}}:{grid:{width:2,height:2,boundsMercator:[-W,-W,W,W],elevations:[100,120,140,160]}});};
try{
 const a=await dynamicTerrain(local);assert.equal(a.elevationStatus,'AVAILABLE');assert.equal(a.previewKind,'POI_AREA');assert.equal(a.roadGeometryAvailable,false);assert.equal(a.roadVerified,false);assert.equal(a.road.anchors.length,3);assert.ok(makeTerrainModel(a).anchors.every(p=>Number.isFinite(p.elevation)));
 const noGeometry=await dynamicTerrain(course(local.route.points,'ROAD_ROUTED'));assert.equal(noGeometry.roadVerified,true);assert.equal(noGeometry.roadGeometryAvailable,false);assert.equal(noGeometry.previewKind,'POI_AREA');assert.equal(calls.length,2,'Successful manifest and DEM tile must be shared');
 const single=await dynamicTerrain(course([point('외딴 명소',37.5,127)]));assert.equal(makeTerrainModel(single).anchors.length,1);assert.ok(Number.isFinite(makeTerrainModel(single).roadPoint(0).x));
 retryTerrainData();globalThis.fetch=async url=>String(url).endsWith('manifest.json')?Response.json({zoom:10,generatedAt:'TEST_PARTIAL',tiles:{'873/396':{url:'10/873/396.json'}}}):Response.json({grid:{width:2,height:2,boundsMercator:[-W,-W,W,W],elevations:[100,120,140,160]}});
 const crossing=course([point('서쪽',37.5,127.24),point('동쪽',37.5,127.29)]),partial=await dynamicTerrain(crossing);
 assert.equal(partial.elevationStatus,'PARTIAL');assert.ok(partial.grid.validity.some(Boolean));assert.ok(partial.grid.validity.some(v=>!v));const pm=makeTerrainModel(partial);assert.ok(pm.min>0,'Missing cells must not lower measured altitude to zero');assert.ok(partial.road.anchors.some(a=>!hasElevation(partial,...mercator(...a.coordinate))));
 retryTerrainData();globalThis.fetch=async()=>new Response('',{status:503});const fallback=await dynamicTerrain(local);assert.equal(fallback.elevationStatus,'UNAVAILABLE');assert.equal(fallback.sources.elevation,'UNAVAILABLE');assert.equal(fallback.roadGeometryAvailable,false);
}finally{globalThis.fetch=originalFetch;retryTerrainData();}
let loads=0;const data=await(async()=>{globalThis.fetch=async url=>Response.json(String(url).endsWith('manifest.json')?{zoom:0,tiles:{'0/0':{url:'0/0/0.json'}}}:{grid:{width:2,height:2,boundsMercator:[-W,-W,W,W],elevations:[100,120,140,160]}});try{return await dynamicTerrain(local);}finally{globalThis.fetch=originalFetch;}})();
const loader=makeLatestTerrainLoader(()=>{loads++;return data;});await loader.select(local.id,local);await loader.select(local.id,local);assert.equal(loads,1);loader.evict(local.id,local);await loader.select(local.id,local);assert.equal(loads,2,'Only an explicit retry evicts a cached model');
const none=connectionSection(local,'none',false);assert.doesNotMatch(none,/data-tesla-preview|data-native-route|Tesla 계정/);assert.match(none,/연동 없이 사용/);
assert.doesNotMatch(connectionSection(local,'pleos',false),/data-native-route|data-tesla-preview/);assert.match(connectionSection(local,'pleos',true),/data-native-route/);
assert.match(connectionSection(local,'tesla',false,true),/data-tesla-preview/);assert.match(connectionSection(local,'tesla',false,true),/일괄 전송은 지원하지/);assert.doesNotMatch(connectionSection(local,'tesla',false,false),/data-tesla-preview/);
assert.match(connectionSection(local,'other',false),/data-copy-stops/);assert.doesNotMatch(connectionSection(local,'other',false),/data-tesla-preview/);
console.log('PASS: all-stop terrain framing, representative clusters, verified-without-geometry separation, DEM sharing/failure/retry, 2D stop sketches and manufacturer-neutral connection contracts.');
