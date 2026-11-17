import assert from 'node:assert/strict';
import {courseFromApi,bookmarkTemplate,restoreBookmarks,arrivalTimes} from '../dist/dynamic-courses.js';
import {routeWindow,dynamicTerrain} from '../dist/dynamic-terrain.js';
import {makeTerrainModel,makeLatestTerrainLoader} from '../dist/terrain-model.js';
const item={id:'dyn-new-id-never-in-catalog',name:'새 전국 명소',scenery:'forest',region:'테스트 지역',latitude:37.5,longitude:127,
 estimatedRoundTripKm:100,estimatedMinutes:180,stopMinutes:20,reasons:['테스트'],waypoints:[{id:'osm:node:1',name:'공개 명소',latitude:37.5,longitude:127}],
 navigationTicket:'must-not-persist',route:{status:'ROAD_ROUTED',generatedAt:'2026-11-16T00:00:00Z',points:[{name:'개인 출발지',latitude:37.6,longitude:127,type:'ORIGIN'},{name:'공개 명소',latitude:37.5,longitude:127,type:'SCENIC_WAYPOINT'},{name:'복귀',latitude:37.6,longitude:127,type:'RETURN'}],legs:[{geometry:[{latitude:37.6,longitude:127},{latitude:37.5,longitude:127},{latitude:37.6,longitude:127}]}]}};
const course=courseFromApi(item);assert.equal(course.name,item.name);assert.equal(course.km,100);
assert.deepEqual(arrivalTimes({...course,route:{...course.route,stopSeconds:1200,legs:[{durationSeconds:600},{durationSeconds:1200}]}},0),[0,600000,3000000]);
assert.throws(()=>courseFromApi({...item,id:'\" onclick=alert(1)'}));
const template=bookmarkTemplate(course),serialized=JSON.stringify(template);
assert.ok(!serialized.includes('must-not-persist'));assert.ok(!serialized.includes('37.6'));assert.ok(!serialized.includes('個人'));assert.equal(template.waypoints.length,1);
const restored=restoreBookmarks({getItem(key){return key==='flowad-bookmarks-v2'?JSON.stringify([template]):'["yangpyeong"]';}});
assert.equal(restored.templates.size,1);assert.equal(restored.legacyCount,1);assert.equal(restored.templates.get(course.id).savedTemplate,true);
const long={...course,route:{...course.route,legs:[{geometry:[{latitude:37.5,longitude:127},{latitude:38.5,longitude:128}]}]}};
const preview=routeWindow(long);assert.equal(preview.coverage.kind,'HIGHLIGHT_SEGMENT');assert.ok(preview.coverage.toKm-preview.coverage.fromKm<=20.001);
let calls=0;
globalThis.fetch=async()=>{calls++;return new Response('{"zoom":10,"tiles":{}}',{headers:{'Content-Type':'application/json'}});};
const data=await dynamicTerrain(course);assert.equal(data.elevationStatus,'UNAVAILABLE');assert.equal(calls,1);
assert.ok(makeTerrainModel(data).road.length>=2);assert.equal(data.sources.elevation,'UNAVAILABLE');
const loader=makeLatestTerrainLoader(async(id,context)=>({...data,courseId:id,capturedAt:context.route.generatedAt}));
const older=loader.select(course.id,course);const newer=loader.select(course.id,{route:{generatedAt:'new'}});
assert.equal((await older).current,false);assert.equal((await newer).current,true);
for(let i=0;i<20;i++)await loader.select('dyn-'+i,{route:{generatedAt:'new'}});
assert.ok(loader.size()<=8);
console.log('PASS: unknown dynamic IDs, public-only bookmarks, legacy archive, road-only terrain, coverage clipping, races and bounded caches.');
