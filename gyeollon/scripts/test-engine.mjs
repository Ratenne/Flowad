import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dist/engine.js',import.meta.url),'utf8');
const engine=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const seoul={lat:37.5665,lng:126.978,label:'서울'},busan={lat:35.1796,lng:129.0756,label:'부산'};
assert.equal(engine.haversine(seoul,seoul),0);
assert.ok(engine.haversine(seoul,busan)>320&&engine.haversine(seoul,busan)<330);
const raw={id:'sample',lat:37.543,lng:127.323,km:108,minutes:175,walk:20,spots:[['start',''],['stop1',''],['stop2',''],['end','']]};
const near=engine.routeFromOrigin(raw,seoul),far=engine.routeFromOrigin(raw,busan);
assert.ok(near.km<far.km);assert.ok(near.minutes<180);assert.ok(far.minutes>480);assert.equal(near.spots[0][0],'서울 출발');assert.equal(near.spots[3][0],'서울 복귀');assert.equal(raw.km,108);
const now=Date.parse('2026-10-23T23:00:00Z');
assert.equal(engine.departureTimestamp('morning',now),Date.parse('2026-10-24T00:00:00Z'));
assert.equal(engine.departureTimestamp('morning',Date.parse('2026-10-24T02:00:00Z')),Date.parse('2026-10-25T00:00:00Z'));
assert.equal(engine.departureTimestamp('now',now),now);
const series={hourly:{time:[100,200],temperature_2m:[20,30],wind_speed_10m:[2,12],weather_code:[1,95]}};
assert.equal(engine.weatherAt(series,105000).temp,20);assert.equal(engine.weatherAt(series,200000).severe,true);assert.equal(engine.weatherAt({},now),null);assert.equal(engine.classifyWeather(3),'cloudy');assert.equal(engine.classifyWeather(61),'rainy');assert.equal(engine.weatherIsSevere(71),true);
// Exercise the browser-permission callback boundary without requesting a person's actual location.
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const request=app.slice(app.indexOf('function requestLocation()'),app.indexOf('function applyOriginWeather()'));
function harness(mode){let selected,opened=0;const nodes=new Map();const get=s=>{if(!nodes.has(s))nodes.set(s,{disabled:false,open:false,classList:{add(){},remove(){}}});return nodes.get(s)};const sandbox={state:{locating:false},$ :get,$$:()=>[],Number,navigator:{geolocation:{getCurrentPosition(success,failure){if(mode==='success')success({coords:{latitude:seoul.lat,longitude:seoul.lng}});else failure({code:1})}}},departureCities:()=>[{name:'서울',...seoul}],haversine:engine.haversine,applyLocation:loc=>selected=loc,toast(){},renderCities(){},openDialog(){opened++}};vm.createContext(sandbox);vm.runInContext(request+';requestLocation();',sandbox);return{selected,opened,state:sandbox.state,nodes}}
assert.equal(harness('success').selected.kind,'gps');assert.equal(harness('success').selected.lat,seoul.lat);assert.equal(harness('denied').selected,undefined);assert.equal(harness('denied').opened,1);assert.equal(harness('denied').state.locating,false);
console.log('PASS: distance, coordinate-based timing, return itinerary, KST scheduling, forecast selection, weather exclusion flags, GPS success and permission-denied callbacks.');
