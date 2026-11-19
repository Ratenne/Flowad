import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validCoordinates} from '../dist/location-service.js';
import {courseFromApi} from '../dist/dynamic-courses.js';
import './test-location-service.mjs';
import './test-location-environment.mjs';

// Exercise the actual app's asynchronous boundaries with synthetic GPS and API responses.
const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
const nodes = new Map();
const get = selector => {
  if (!nodes.has(selector)) nodes.set(selector, {
    value: '180', checked: false, textContent: '', open: false,
    addEventListener(type, handler) { this[type==='close'?'onclose':type] = handler; },
    close() { if(this.open){this.open=false;this.onclose?.();} }
  });
  return nodes.get(selector);
};
let finishFix, failFix, reportFix, finishTesla, failTesla, measurements = 0, teslaLookups = 0, statusLookups = 0;
let pagehide;
const gps = {lat: 37.5, lng: 127, accuracy: 10, source: 'BROWSER_GPS'};
const pending = [];
const context = vm.createContext({
  state: {location: null, weatherSource: 'demo'}, locationRevision: 0,
  locationEnvironment:{vehicle:false,provider:'browser'},
  teslaLocationAbort: null, teslaCsrf:'test',
  recommendationRequest: 0, recommendationAbort: null, recommendations: [],
  $: get, sceneAPI:null, render() {}, syncSelection() {}, setDrivingPreview() {},
  paintLocation(location) { get('#locationLabel').textContent=location.label; },
  publishLocationStatus(message) { get('#locationStatus').textContent=message; get('#mainLocationStatus').textContent=message; },
  setLocating(on) { context.state.locating = on; },
  invalidateLocationWork() {
    context.locationRevision++;
    context.teslaLocationAbort?.abort();
    context.recommendationRequest++;
    context.recommendationAbort?.abort();
  },
  locationService: {request({onProgress}) { measurements++; reportFix=onProgress; return new Promise((resolve,reject) => { finishFix = resolve; failFix = reject; }); }},
  departureCities: () => [], applyLocation(location) {
    context.state.locating = false;
    context.state.location = location;
  },
  window: {addEventListener(type, handler) { if (type === 'pagehide') pagehide = handler; }},
  document: {addEventListener() {}},
  renderCities() {}, openDialog() {},
  effectiveRoutes: () => [{id:'test'}], weatherFor: () => ({}),
  fetch(url, options) {
    if(url==='./api/tesla/status'){
      statusLookups++;
      return Promise.resolve({ok:true,json:async()=>({
        connection:'CONNECTED',locationReady:true,csrf:'test',secure:true
      })});
    }
    return new Promise(resolve => pending.push({body: JSON.parse(options.body), resolve}));
  },
  teslaPost() { teslaLookups++; return new Promise((resolve,reject) => { finishTesla = resolve; failTesla=reject; }); },
  teslaError() {get('#teslaData').textContent='차량 위치 정보를 사용할 수 없습니다.';},
  validCoordinates, courseFromApi, crypto:globalThis.crypto, AbortController, setTimeout, clearTimeout
});
vm.runInContext(
  slice('function cancelLocationRequest()', 'function applyOriginWeather()') +
  slice('async function updateResults()', 'function saveRoute(') +
  slice("$('#teslaLocation').addEventListener", "$('#teslaDisconnect').addEventListener"), context
);
const measure = vm.runInContext('requestLocation()', context);
await vm.runInContext('requestLocation()', context);
await vm.runInContext('updateResults()', context);
assert.equal(measurements, 1);
assert.equal(pending.length, 0);
finishFix(gps);
await measure;
assert.equal(statusLookups, 0);
assert.equal(teslaLookups, 0);
const old = vm.runInContext('updateResults()', context);
const tesla = get('#teslaLocation').click();
const newerGps = vm.runInContext('requestLocation()', context);
finishTesla({status:'LIVE', latitude: 35, longitude: 129, observedAt: Date.now()});
await tesla;
assert.equal(context.state.location, null);
finishFix({...gps, lat: 36});
await newerGps;
const recent = vm.runInContext('updateResults()', context);
const reply = km => ({ok:true, json:async () => ({
  courses:[{id:'test',name:'테스트 동적 코스',estimatedMinutes:45,estimatedRoundTripKm:km,route:{points:[{name:'출발지',latitude:37.5,longitude:127,type:'ORIGIN'},{name:'복귀지',latitude:37.5,longitude:127,type:'RETURN'}]}}]
})});
assert.deepEqual(pending.map(x=>x.body.latitude), [37.5, 36]);
pending[1].resolve(reply(25));
await recent;
pending[0].resolve(reply(99));
await old;
assert.equal(context.recommendations[0].km, 25);
assert.equal(context.state.location.kind, 'gps');
assert.equal(context.state.location.label, '현재 위치');
const acceptedTesla = get('#teslaLocation').click();
finishTesla({status:'LIVE', latitude: 35, longitude: 129, observedAt: Date.now()});
await acceptedTesla;
assert.equal(context.state.location.kind, 'tesla');
assert.equal(context.state.location.accuracy, undefined);
const leaving = vm.runInContext('requestLocation()', context);
const retainedLocation=context.state.location;
const retainedResults=context.recommendations;
const retainedSelection=context.state.selected='test';
const retainedTab=context.state.tab='saved';
reportFix({fix:{...gps,accuracy:1500}});
assert.equal(context.state.location,retainedLocation);
assert.equal(context.recommendations,retainedResults);
assert.equal(context.state.selected,retainedSelection);
assert.equal(context.state.tab,retainedTab);
assert.match(get('#mainLocationStatus').textContent,/출발 위치를 확인/);
assert.doesNotMatch(get('#mainLocationStatus').textContent,/위도|경도|1500|BROWSER|GPS/);
assert.equal(pending.length,2,'Progress must not request recommendations');
const previousStatus=context.state.browserPreviousResultStatus;
pagehide();
finishFix(gps);
await leaving;
assert.equal(context.state.location,retainedLocation);
assert.equal(get('#resultStatus').textContent,previousStatus);

// Browser failures never query Tesla, regardless of failure reason.
for(const code of ['LOW_ACCURACY','TIMEOUT','DENIED','UNAVAILABLE','UNSUPPORTED','INSECURE','STALE']){
  const browser=vm.runInContext('requestLocation()',context);
  failFix({code});
  await browser;
  assert.equal(context.state.location,retainedLocation);
  assert.equal(context.state.locating,false);
  assert.match(get('#mainLocationStatus').textContent,/브라우저 위치/);
}
assert.equal(statusLookups,0);
assert.equal(teslaLookups,2);

const beforeVehicle=measurements;
const staleVehicle=get('#teslaLocation').click();
finishTesla({status:'LIVE',latitude:35,longitude:129,observedAt:Date.now()-901000});
await staleVehicle;
assert.equal(context.state.locating,false);
assert.match(get('#mainLocationStatus').textContent,/오래됐거나/);
const failedVehicle=get('#teslaLocation').click();
failTesla(Error('LOCATION_UNAVAILABLE'));
await failedVehicle;
assert.equal(context.state.locating,false);
assert.match(get('#locationLabel').textContent,/미확인/);
assert.equal(measurements,beforeVehicle);

// Run the actual confirmation and manual-origin handlers, plus applyLocation.
let addressEffects=0, weatherEffects=0, recommendationEffects=0;
Object.assign(context,{
  paintLocationEnvironment(){}, requestPreferredLocation(){}, paintWeather(){},
  loadWeather(){weatherEffects++;}, updateResults(){recommendationEffects++;},
  lookupLocationAddress(){addressEffects++;},
  openDialog(node){node.open=true;},
  departureCities:()=>[{name:'테스트 출발지',lat:35.1,lng:129.1}]
});
vm.runInContext(slice('function applyLocation(location)', 'function cancelLocationRequest()')+
  slice('function initLocationControls()', '// Tesla:')+'initLocationControls();',context);
const approximate=vm.runInContext('requestLocation()',context);
reportFix({fix:{...gps,accuracy:500}});
failFix({code:'LOW_ACCURACY',fix:{...gps,accuracy:500,observedAt:Date.now()}});
await approximate;
assert.equal(context.state.location,null);
assert.equal(addressEffects+weatherEffects+recommendationEffects,0);
assert.equal(get('#useApproximateLocation').hidden,false);
get('#useApproximateLocation').click();
assert.equal(context.state.location.quality,'APPROXIMATE');
assert.equal(context.state.location.userConfirmed,true);
assert.equal(addressEffects,0);
assert.equal(weatherEffects,1);
assert.equal(recommendationEffects,0,'Wait for the initial forecast instead of issuing a duplicate recommendation');
context.updateResults();
assert.equal(recommendationEffects,1);

const manual=vm.runInContext('requestLocation()',context);
const lateManualFix=finishFix, lateProgress=reportFix;
get('#manualLocation').click();
get('#cityChoices').click({target:{closest:()=>({dataset:{city:'테스트 출발지'}})}});
const manualOrigin=context.state.location;
lateProgress({fix:{...gps,accuracy:1}});
lateManualFix({...gps,accuracy:1});
await manual;
assert.equal(context.state.location,manualOrigin);
assert.equal(manualOrigin.kind,'manual');
assert.equal(manualOrigin.lat,35.1);
context.updateResults();
assert.equal(recommendationEffects,2);
assert.equal(addressEffects,0);

const normal=vm.runInContext('requestLocation()',context);
finishFix({...gps,observedAt:Date.now(),quality:'HIGH',accuracyAccepted:true,userConfirmed:false});
await normal;
assert.equal(context.state.location.kind,'gps');
assert.equal(context.state.location.lat,gps.lat);
assert.equal(addressEffects,1);
assert.equal(weatherEffects,3);
context.updateResults();
assert.equal(recommendationEffects,3);
assert.equal(statusLookups,0);
assert.equal(teslaLookups,4);
const deadlineFallback=vm.runInContext('requestLocation()',context);
finishFix({...gps,accuracy:1500,observedAt:Date.now(),quality:'LOW',accuracyAccepted:false,fallbackUsed:true,userConfirmed:false});
await deadlineFallback;
assert.equal(context.state.location.accuracy,1500);
assert.equal(context.state.location.fallbackUsed,true);
assert.equal(addressEffects,1,'A coarse deadline fallback must not request a precise address');
assert.equal(weatherEffects,4,'The accepted fallback may start weather/recommendation work without a second confirmation');
console.log('PASS: mocked app progress, preserved results, manual edit/late callbacks, confirmation, recommendations and GPS/Tesla source separation.');

const addressLookups = [];
let mapDraft=null;const confirmedMapOrigins=[];
const addressContext = vm.createContext({
  state: {location: null}, locationRevision: 0, addressAbort: null,
  createNaverMapView:()=>({show(){},close(){},getSelection(){return mapDraft;}}),window:{addEventListener(){}},
  openDialog(dialog){dialog.open=true;},toast(){},applyLocation(location){confirmedMapOrigins.push(location);addressContext.state.location=location;},
  $: get, AbortController, setTimeout, clearTimeout,
  fetch(url, options) {
    assert.equal(url, './api/location/address');
    assert.equal(options.method, 'POST');
    return new Promise(resolve => addressLookups.push(resolve));
  }
});
vm.runInContext(slice('function describeOrigin(location)', 'function applyLocation(location)'), addressContext);
const originalMapOrigin={lat:37.5,lng:127,kind:'gps'};addressContext.state.location=originalMapOrigin;
get('#naverMapButton').click();mapDraft={lat:37.51,lng:127.01};
assert.equal(addressContext.state.location,originalMapOrigin,'Dragging must not change the current source before confirmation');
get('#confirmMapLocation').click();assert.equal(confirmedMapOrigins.length,1);assert.equal(confirmedMapOrigins[0].kind,'manual');assert.equal(confirmedMapOrigins[0].source,'MAP_PICK');assert.equal(confirmedMapOrigins[0].lat,37.51);assert.equal(get('#naverMapDialog').open,false);
get('#naverMapButton').click();addressContext.state.location={lat:35.2,lng:129,kind:'tesla'};get('#confirmMapLocation').click();assert.equal(confirmedMapOrigins.length,1,'A changed origin must invalidate the old map selection');
assert.match(vm.runInContext("describeOrigin({kind:'manual',source:'MAP_PICK',label:'지도'})",addressContext),/직접 선택/);
function requestAddress(location) {
  addressContext.state.location = location;
  addressContext.locationRevision++;
  return vm.runInContext('lookupLocationAddress(state.location)', addressContext);
}
const oldAddress = requestAddress({...gps, kind:'gps'});
const newAddress = requestAddress({...gps, kind:'tesla'});
addressLookups[1]({ok:true,status:200,json:async()=>({type:'NEARBY_ADDRESS',label:'테스트로 25'})});
await newAddress;
addressLookups[0]({ok:true,status:200,json:async()=>({type:'BUILDING',label:'이전 건물'})});
await oldAddress;
assert.equal(get('#locationLabel').textContent, '가까운 주소 · 테스트로 25');

const missingAddress=requestAddress({...gps,kind:'tesla',label:'Tesla 차량 위치',observedAt:Date.now()});
addressLookups[2]({ok:false,status:503,headers:{get:()=> 'JUSO_NOT_CONFIGURED'}});
await missingAddress;
assert.equal(get('#locationLabel').textContent,'현재 위치');
assert.match(get('#mainLocationStatus').textContent,/차량 위치에서 출발/);
assert.doesNotMatch(get('#mainLocationStatus').textContent,/승인키|위도|경도|37\.5|127|Tesla/);
assert.doesNotMatch(get('#mainLocationStatus').textContent,/확인 중/);
const emptyAddress=requestAddress({...gps,kind:'gps',label:'현재 위치'});
addressLookups[3]({ok:true,status:204});
await emptyAddress;
assert.match(get('#mainLocationStatus').textContent,/현재 위치에서 출발/);
const officialAddress=requestAddress({...gps,kind:'gps',label:'현재 위치'});
addressLookups[4]({ok:true,status:200,json:async()=>({type:'ROAD_ADDRESS',label:'테스트로 1',source:'JUSO_MAP'})});
await officialAddress;
assert.equal(get('#locationLabel').textContent,'테스트로 1');
assert.match(get('#mainLocationStatus').textContent,/현재 위치에서 출발/);
const deniedAddress=requestAddress({...gps,kind:'tesla',label:'Tesla 차량 위치'});
addressLookups[5]({ok:false,status:503,headers:{get:()=> 'JUSO_KEY_REJECTED'}});
await deniedAddress;
assert.equal(get('#locationLabel').textContent,'현재 위치');
assert.doesNotMatch(get('#mainLocationStatus').textContent,/승인키|JUSO|BROWSER/);

const coarseContext = vm.createContext({
  state:{}, recommendations:[], $:get,
  invalidateLocationWork(){}, setLocating(){}, paintWeather(){}, updateResults(){},
  paintLocation(){}, render(){}, loadWeather(){},
  lookupLocationAddress(){throw Error('Coarse coordinates must not identify an address');}
});
vm.runInContext(slice('function applyLocation(location)', 'function cancelLocationRequest()'), coarseContext);
vm.runInContext("applyLocation({kind:'gps',quality:'APPROXIMATE',accuracy:500})", coarseContext);
assert.equal(coarseContext.state.location.addressLabel, undefined);
vm.runInContext("applyLocation({kind:'gps',quality:'LOW',accuracy:1500,fallbackUsed:true})", coarseContext);
assert.equal(coarseContext.state.location.addressLabel, undefined);
assert.match(vm.runInContext("describeOrigin({kind:'gps',source:'BROWSER_CACHE',quality:'LOW',accuracy:1500,fallbackUsed:true,observedAt:Date.now()})", addressContext), /대략적인 위치/);
assert.match(vm.runInContext("describeOrigin({kind:'gps',quality:'APPROXIMATE',accuracy:500})", addressContext), /대략적인 위치/);
