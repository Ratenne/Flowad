import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLocationService, nearbyLocationPolicy, validCoordinates} from '../dist/location-service.js';

const policy = {...nearbyLocationPolicy, initialMs: 25, samplingMs: 8};
let now = 100_000;
const fix = (accuracy, age = 0, speed = null) => ({
  timestamp: now - age, coords: {latitude: 37.5, longitude: 127, accuracy, speed}
});
function fake(first, samples = [], permission = 'granted') {
  const counts = {first: 0, watch: 0, cleared: 0};
  const deliver = (value, good, bad) => {
    if (value?.code) bad(value);
    else if (value) good(value);
  };
  const service = createLocationService({
    geolocation: {
      getCurrentPosition(good, bad, options) {
        counts.first++;
        assert.deepEqual(options, {enableHighAccuracy: true, timeout: 25, maximumAge: 0});
        deliver(first, good, bad);
      },
      watchPosition(good, bad) {
        counts.watch++;
        for (const value of samples) deliver(value, good, bad);
        return 0;
      },
      clearWatch(id) { assert.equal(id, 0); counts.cleared++; }
    },
    permissions: {query: async () => ({state: permission})},
    now: () => now, policy
  });
  return {service, counts};
}

const high = fake(fix(10));
assert.equal((await high.service.request()).quality, 'HIGH');
assert.deepEqual(high.counts, {first: 1, watch: 0, cleared: 0});
assert.equal((await fake(fix(50)).service.request()).quality, 'MEDIUM');
await assert.rejects(fake(fix(200)).service.request(), {code: 'LOW_ACCURACY'});
const denied = fake(fix(10), [], 'denied');
await assert.rejects(denied.service.request(), {code: 'DENIED'});
assert.equal(denied.counts.first, 0);
await assert.rejects(fake({code: 1}).service.request(), {code: 'DENIED'});
await assert.rejects(fake(null).service.request(), {code: 'TIMEOUT'});
await assert.rejects(fake(fix(10, 16000)).service.request(), {code: 'STALE'});
await assert.rejects(fake({code: 2}, [{code: 2}]).service.request(), {code: 'UNAVAILABLE'});
await assert.rejects(createLocationService({secure: false}).request(), {code: 'INSECURE'});

const retry = fake({code: 2}, [fix(150), fix(10)]);
assert.equal((await retry.service.request()).accuracy, 10);
assert.deepEqual(retry.counts, {first: 1, watch: 1, cleared: 1});
assert.equal((await fake(fix(45), [fix(80)]).service.request()).accuracy, 45);
assert.equal((await fake(fix(45, 14000), [fix(65)]).service.request()).accuracy, 65);
assert.equal((await fake(fix(50), [fix(10, 16000)]).service.request()).accuracy, 50);
const stationary = fake(fix(10, 0, 0));
await stationary.service.request();
assert.equal((await stationary.service.request()).source, 'BROWSER_CACHE');
now += 16000;
await assert.rejects(stationary.service.request(), {code: 'STALE'});
assert.equal(stationary.counts.first, 2);

const cancelled = fake(fix(50));
const first = cancelled.service.request();
assert.equal(cancelled.service.request(), first);
await new Promise(resolve => setImmediate(resolve));
cancelled.service.cancel();
await assert.rejects(first, {code: 'CANCELLED'});
assert.deepEqual(cancelled.counts, {first: 1, watch: 1, cleared: 1});

// Exercise the actual app's asynchronous boundaries with synthetic GPS and API responses.
const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
const nodes = new Map();
const get = selector => {
  if (!nodes.has(selector)) nodes.set(selector, {
    value: '180', checked: false, textContent: '', open: false,
    addEventListener(type, handler) { this[type] = handler; }
  });
  return nodes.get(selector);
};
let finishFix, failFix, finishTesla, measurements = 0, teslaLookups = 0, statusLookups = 0;
let fallbackReady = true;
let pagehide;
const gps = {lat: 37.5, lng: 127, accuracy: 10, source: 'BROWSER_GPS'};
const pending = [];
const context = vm.createContext({
  state: {location: null, weatherSource: 'demo'}, locationRevision: 0,
  teslaFallbackAbort: null,
  recommendationRequest: 0, recommendationAbort: null, recommendations: [],
  $: get, render() {}, syncSelection() {}, setDrivingPreview() {},
  setLocating(on) { context.state.locating = on; },
  invalidateLocationWork() {
    context.locationRevision++;
    context.teslaFallbackAbort?.abort();
    context.recommendationRequest++;
    context.recommendationAbort?.abort();
  },
  locationService: {request() { measurements++; return new Promise((resolve,reject) => { finishFix = resolve; failFix = reject; }); }},
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
      return Promise.resolve({ok:true,json:async()=>({locationReady:fallbackReady,csrf:'test'})});
    }
    return new Promise(resolve => pending.push({body: JSON.parse(options.body), resolve}));
  },
  teslaPost() { teslaLookups++; return new Promise(resolve => { finishTesla = resolve; }); },
  validCoordinates, AbortController, setTimeout, clearTimeout
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
  courses:[{id:'test', estimatedRoundTripKm:km, route:{points:[]}}]
})});
assert.deepEqual(pending.map(x=>x.body.latitude), [37.5, 36]);
pending[1].resolve(reply(25));
await recent;
pending[0].resolve(reply(99));
await old;
assert.equal(context.recommendations[0].km, 25);
assert.equal(context.state.location.kind, 'gps');
const acceptedTesla = get('#teslaLocation').click();
finishTesla({status:'LIVE', latitude: 35, longitude: 129, observedAt: Date.now()});
await acceptedTesla;
assert.equal(context.state.location.kind, 'tesla');
assert.equal(context.state.location.accuracy, undefined);
const leaving = vm.runInContext('requestLocation()', context);
pagehide();
finishFix(gps);
await leaving;
assert.equal(context.state.location, null);
assert.equal(get('#resultStatus').textContent, '위치 확인을 취소했어요.');

const fallback = vm.runInContext('requestLocation()', context);
failFix({code:'LOW_ACCURACY'});
await new Promise(resolve => setImmediate(resolve));
assert.equal(teslaLookups, 3);
finishTesla({status:'LIVE', latitude: 35, longitude: 129, observedAt: Date.now()});
await fallback;
assert.equal(context.state.location.kind, 'tesla');
assert.equal(context.state.location.lat, 35);

const stale = vm.runInContext('requestLocation()', context);
failFix({code:'TIMEOUT'});
await new Promise(resolve => setImmediate(resolve));
finishTesla({status:'LIVE', latitude: 35, longitude: 129, observedAt: Date.now()-61000});
await stale;
assert.equal(context.state.location, null);
assert.match(get('#resultStatus').textContent, /Tesla 차량 위치도 오래됐어요/);

const deniedFallback = vm.runInContext('requestLocation()', context);
failFix({code:'DENIED'});
await deniedFallback;
assert.equal(statusLookups, 2);
assert.equal(teslaLookups, 4);

fallbackReady = false;
const disconnected = vm.runInContext('requestLocation()', context);
failFix({code:'UNAVAILABLE'});
await disconnected;
assert.equal(statusLookups, 3);
assert.equal(teslaLookups, 4);
assert.equal(context.state.location, null);
console.log('PASS: location accuracy, age, retries, permission, cancellation, duplicate clicks, stale API responses and GPS/Tesla source separation.');
