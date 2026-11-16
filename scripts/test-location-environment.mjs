import assert from 'node:assert/strict';
import {detectLocationEnvironment, locationProvider, createNativeLocationService} from '../dist/location-environment.js';

for(const userAgent of ['Mozilla/5.0 (Windows NT 10.0)', 'Mozilla/5.0 (iPhone)', 'Mozilla/5.0 (Linux; Android 14)']){
  const environment=detectLocationEnvironment({userAgent});
  assert.equal(environment.vehicle,false);
  assert.equal(locationProvider(environment,'device'),'browser');
  assert.equal(locationProvider(environment,'vehicle'),'tesla');
}
for(const input of [{userAgent:'Mozilla/5.0 Tesla/2026.1'}, {nativeLocation:{}}, {nativeNavigation:{}}, {userAgent:'Mozilla/5.0 FlowadPleos/1.0'}]){
  const environment=detectLocationEnvironment(input);
  assert.equal(environment.vehicle,true);
  assert.equal(locationProvider(environment,'device'),environment.provider);
  assert.equal(locationProvider(environment,'vehicle'),environment.provider);
}
assert.equal(detectLocationEnvironment({userAgent:'Tesla',nativeLocation:{}}).provider,'native');

await assert.rejects(createNativeLocationService().request(),/VEHICLE_LOCATION_UNSUPPORTED/);
const messages=[];
const bridge={postMessage(message){messages.push(JSON.parse(message));}};
const service=createNativeLocationService(bridge);
const request=service.request();
assert.equal(service.request(),request);
const {requestId}=messages[0];
bridge.onmessage({data:JSON.stringify({type:'LOCATION_RESULT',requestId:'old',latitude:0})});
bridge.onmessage({data:JSON.stringify({type:'LOCATION_RESULT',requestId,status:'LIVE',latitude:37.5,longitude:127,observedAt:Date.now(),stale:false})});
assert.equal((await request).latitude,37.5);
assert.equal(bridge.onmessage,null);

const controller=new AbortController();
const cancelled=service.request({signal:controller.signal});
const reject=assert.rejects(cancelled,{name:'AbortError'});
const lateCallback=bridge.onmessage;
controller.abort();await reject;
assert.equal(messages.at(-1).type,'LOCATION_CANCEL');
assert.equal(bridge.onmessage,null);
const next=service.request();
lateCallback({data:JSON.stringify({type:'LOCATION_RESULT',requestId:messages[1].requestId,latitude:0})});
assert.equal(typeof bridge.onmessage,'function','A late cancelled reply must not remove the new request handler');
bridge.onmessage({data:JSON.stringify({type:'LOCATION_RESULT',requestId:messages.at(-1).requestId,error:'VEHICLE_LOCATION_UNAVAILABLE'})});
await assert.rejects(next,/VEHICLE_LOCATION_UNAVAILABLE/);
console.log('PASS: PC/mobile defaults, vehicle source lock, native location replies, cancellation and request isolation.');
