import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {multiEntryMarkup,multiPreviewMarkup,multiResultMarkup} from '../dist/tesla-multi.js';
import {hasFreshRoadProof,roadVerificationCredential} from '../dist/navigation-readiness.js';
const fixture={planId:'MOCK_PLAN',mode:'MULTI_STOP',status:'PREVIEW_READY',commandStatus:'COMMAND_NOT_SENT',roundTrip:true,origin:{name:'합성 출발',latitude:35.18,longitude:129.07},stops:[{order:1,kind:'SCENIC_WAYPOINT',name:'합성 풍경',latitude:35.2,longitude:129.2},{order:2,kind:'DESTINATION',name:'합성 목적지',latitude:35.3,longitude:129.3},{order:3,kind:'RETURN',name:'합성 복귀',latitude:35.18,longitude:129.07}]};
assert.equal(multiEntryMarkup('dyn-test',false),'');assert.match(multiEntryMarkup('dyn-test',true),/data-tesla-multi-preview/);
const markup=multiPreviewMarkup(fixture,'dyn-test');
assert.ok(markup.indexOf('합성 풍경')<markup.indexOf('합성 목적지'));assert.ok(markup.indexOf('합성 목적지')<markup.indexOf('합성 복귀'));
assert.doesNotMatch(markup,/data-multi-send/);assert.doesNotMatch(markup,/35\.18|129\.07|HMAC|MOCK_PLAN/);
assert.match(multiPreviewMarkup({...fixture,origin:{name:'<script>test</script>'}},'dyn-test'),/&lt;script&gt;/);
assert.match(multiResultMarkup({status:'DRY_RUN_VALIDATED',commandStatus:'COMMAND_NOT_SENT'}),/차량 명령 미전송/);
const gpsReview=multiResultMarkup({...fixture,strategy:'GPS_ORDERED',status:'DRY_RUN_VALIDATED',canSend:true});
assert.match(gpsReview,/id="multiConsent"/);assert.match(gpsReview,/data-multi-send/);assert.doesNotMatch(gpsReview,/query_place_id/);
assert.match(multiResultMarkup({commandStatus:'COMMAND_API_ACCEPTED'}),/차량 내비 반영 미확인/);
assert.match(multiResultMarkup({commandStatus:'COMMAND_REJECTED',error:'PARTIAL_COMMAND_ACCEPTANCE'}),/전체 코스 전송 완료가 아니/);
assert.match(multiResultMarkup({commandStatus:'COMMAND_RESULT_UNKNOWN',requiresVehicleCheck:true}),/모든 경유지와 방문 순서/);

// Execute the actual delegated click handler against synthetic DOM/API ports.
// No browser, real location, OAuth or vehicle endpoint is used by this test.
const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const marker="$('#detailDialog').addEventListener('click',async e=>{\n const preview=e.target.closest('[data-tesla-multi-preview]')";
const source=app.slice(app.indexOf(marker));assert(source.startsWith(marker));
let handler;const calls=[],origin={},course={id:'dyn-test',navigationTicket:'MOCK_ESTIMATED'},resultNode={textContent:'',innerHTML:'',insertAdjacentHTML(_position,value){this.innerHTML+=value;}};
const output={textContent:'',innerHTML:'',querySelector(){return resultNode;},insertAdjacentHTML(_position,value){this.innerHTML+=value;}};
const state={integration:'none',location:origin},nodes={'#detailDialog':{addEventListener(_event,callback){handler=callback;}},'#teslaNavigationPreview':output,'#teslaMultiStrategy':{value:'GPS_ORDERED'},'#teslaMultiOrderConfirmed':{checked:true},'#teslaMultiResult':resultNode};
const context=vm.createContext({$:selector=>nodes[selector],state,navigationBusy:false,navigationPlan:null,navigationOrigin:null,recommendations:[course],navigationErrors:{TICKET_EXPIRED:'추천 유효 시간이 지났어요.'},multiPreviewMarkup,multiResultMarkup,hasFreshRoadProof,roadVerificationCredential,
 verifyRoad:async r=>{calls.push('verify');r.navigationTicket='MOCK_VERIFIED';r.vehicleTransferAllowed=true;r.roadTicketUntil=Date.now()+295000;return {navigationTicket:'MOCK_VERIFIED'};},
 teslaPost:async(path,body)=>{calls.push({path,body});if(path.endsWith('/preview'))return {...fixture};if(path.endsWith('/dry-run'))return {status:'DRY_RUN_VALIDATED',commandStatus:'COMMAND_NOT_SENT'};throw Error('unexpected endpoint');}
});vm.runInContext(source,context);
const click=async(selector,dataset={})=>{const button={dataset,disabled:false};await handler({target:{closest:key=>key===selector?button:null}});return button;};
await click('[data-tesla-multi-preview]',{teslaMultiPreview:'dyn-test'});assert.equal(calls.length,0,'Neutral/Pleos flows must not enter Tesla multi');
state.integration='tesla';await click('[data-tesla-multi-preview]',{teslaMultiPreview:'dyn-test'});
assert.equal(calls[0],'verify');assert.equal(calls[1].path,'navigation/multi/preview');assert.equal(calls[1].body.ticket,'MOCK_VERIFIED');assert.equal(calls[1].body.strategy,'GPS_ORDERED');assert.equal(context.navigationBusy,false);
await click('[data-tesla-multi-dry-run]');assert.equal(calls[2].path,'navigation/multi/dry-run');assert.deepEqual(Object.keys(calls[2].body),['planId']);assert.match(resultNode.innerHTML,/차량 명령 미전송/);
await click('[data-tesla-multi-preview]',{teslaMultiPreview:'dyn-test',strategy:'WAYPOINTS'});
assert.equal(calls.filter(c=>c==='verify').length,1);
assert.equal(calls[3].body.ticket,'MOCK_VERIFIED');assert.equal(calls[3].body.strategy,'WAYPOINTS');
course.roadTicketUntil=Date.now()-1;course.selectionToken='MOCK_SELECTION';
assert.deepEqual(roadVerificationCredential(course),{selectionToken:'MOCK_SELECTION'});
await click('[data-tesla-multi-preview]',{teslaMultiPreview:'dyn-test'});
assert.equal(calls[4],'verify');assert.equal(calls[5].body.ticket,'MOCK_VERIFIED');
assert.ok(calls.filter(c=>typeof c==='object').every(c=>!c.path.endsWith('/send')));
course.selectionToken=null;
context.teslaPost=async()=>{throw Error('TICKET_EXPIRED');};await click('[data-tesla-multi-preview]',{teslaMultiPreview:'dyn-test'});assert.equal(course.navigationTicket,null);assert.match(resultNode.innerHTML,/data-renew-navigation/);
console.log('PASS: Tesla-only multi UI, complete visit list, disabled live send, escaped labels, verified-ticket preview, dry-run without commands, expiry recovery and API/vehicle result separation.');
