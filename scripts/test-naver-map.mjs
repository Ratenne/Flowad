import assert from 'node:assert/strict';
import {createNaverMapView} from '../dist/naver-map.js';
function harness({fetcher,deferSdk=false,failSdk=false,timeoutMs=100}={}){
 const scripts=[],centers=[],status={textContent:''},container={replaceChildren(){}},counts={destroyed:0,markersCleared:0,requests:0};
 const win={naver:{maps:{
  LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
  Map:class{constructor(_,options){centers.push({lat:options.center.lat,lng:options.center.lng});}destroy(){counts.destroyed++;}},
  Marker:class{setMap(map){if(map===null)counts.markersCleared++;}}
 }}};
 const doc={createElement(){return {remove(){this.removed=true;}};},head:{append(script){scripts.push(script);if(!deferSdk)queueMicrotask(()=>failSdk?win.navermap_authFailure():win[new URL(script.src).searchParams.get('callback')]());}}};
 const view=createNaverMapView({container,status,win,doc,timeoutMs,fetcher:async(...args)=>{counts.requests++;assert.equal(args[0],'./api/location/map-config');return fetcher?fetcher(...args):{ok:true,json:async()=>({provider:'NAVER',keyId:'public-test-id'})};}});
 return {view,scripts,status,win,centers,counts};
}
const first={lat:37.5,lng:127,kind:'gps'},h=harness();
assert.equal(h.scripts.length,0);assert.equal(h.counts.requests,0,'No SDK/config request before explicit open');
await h.view.show(first);assert.equal(h.scripts.length,1);assert.equal(new URL(h.scripts[0].src).searchParams.get('ncpKeyId'),'public-test-id');
assert.deepEqual(h.centers[0],{lat:37.5,lng:127});h.view.close();assert.equal(h.counts.destroyed,1);assert.equal(h.counts.markersCleared,1);
await h.view.show({lat:35.2,lng:129,kind:'tesla'});assert.equal(h.scripts.length,1,'SDK is reused');assert.deepEqual(h.centers[1],{lat:35.2,lng:129});assert.deepEqual(first,{lat:37.5,lng:127,kind:'gps'});h.view.close();
const missing=harness({fetcher:async()=>({ok:false,json:async()=>({error:'NAVER_MAP_NOT_CONFIGURED'})})});await missing.view.show(first);assert.equal(missing.scripts.length,0);assert.match(missing.status.textContent,/설정되지/);
let release;const late=harness({fetcher:()=>new Promise(r=>{release=r;})});const pending=late.view.show(first);late.view.close();release({ok:true,json:async()=>({provider:'NAVER',keyId:'public-test-id'})});await pending;assert.equal(late.scripts.length,0,'Late config after close must not start SDK');assert.equal(late.centers.length,0);
const auth=harness({failSdk:true});await auth.view.show(first);assert.match(auth.status.textContent,/인증에 실패/);assert.equal(auth.scripts[0].removed,true);await auth.view.show(first);assert.equal(auth.scripts.length,2,'Explicit retry after failure');
const slow=harness({deferSdk:true,timeoutMs:10});await slow.view.show(first);assert.match(slow.status.textContent,/응답이 늦/);assert.equal(slow.scripts[0].removed,true);
const bootstrap=harness(),maps=bootstrap.win.naver.maps;bootstrap.win.naver.maps={};const booting=bootstrap.view.show(first);await new Promise(setImmediate);bootstrap.win.naver.maps=maps;await booting;assert.equal(bootstrap.centers.length,1,'Wait for the Map export after the bootstrap callback');assert.equal(bootstrap.scripts.length,1);bootstrap.view.close();
const lateAuth=harness();await lateAuth.view.show(first);lateAuth.win.navermap_authFailure();assert.match(lateAuth.status.textContent,/인증에 실패/);assert.equal(lateAuth.counts.destroyed,1);lateAuth.view.close();assert.equal(lateAuth.win.navermap_authFailure,undefined);
const closing=harness({deferSdk:true}),loading=closing.view.show(first);await new Promise(setImmediate);closing.view.close();closing.win[new URL(closing.scripts[0].src).searchParams.get('callback')]();await loading;assert.equal(closing.centers.length,0,'Late SDK after close must not recreate a map');
console.log('PASS: mocked Naver SDK lazy load/reuse, GPS/vehicle coordinates, missing key, auth failure, timeout, close/late response cleanup and no location mutation.');
