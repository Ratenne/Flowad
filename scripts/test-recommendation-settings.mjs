import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {courseFromApi} from '../dist/dynamic-courses.js';
const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),nodes=new Map(),requests=[];
const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'180',checked:false,open:false,textContent:'',addEventListener(type,handler){this[type==='close'?'onclose':type]=handler;},close(){this.open=false;}});return nodes.get(selector);};
get('#tripMode').value='round';get('#departure').value='now';
const context=vm.createContext({
 state:{location:{lat:37.5,lng:127,label:'테스트 출발지',kind:'manual'},mood:'all',vehicle:'ice',weather:'sunny',temp:20,wind:2,weatherSource:'demo'},
 recommendations:[],recommendationRequest:0,recommendationAbort:null,sceneAPI:null,
 $:get,render(){},syncSelection(){},setDrivingPreview(){},renderCities(){},openDialog(){},toast(){},effectiveRoutes:()=>[],weatherFor:()=>({}),
 courseFromApi,crypto:globalThis.crypto,AbortController,setTimeout:()=>0,clearTimeout(){},
 fetch(url,init){assert.equal(url,'./api/recommendations');return new Promise(resolve=>requests.push({body:JSON.parse(init.body),resolve}));}
});
vm.runInContext(source.slice(source.indexOf('async function updateResults()'),source.indexOf('function saveRoute(')),context);
const binding=source.indexOf("$('#applySettings').addEventListener");vm.runInContext(source.slice(binding,source.indexOf(';',binding)),context);
get('#settingsDialog').open=true;
await context.updateResults();context.state.mood='forest';await context.updateResults();
assert.equal(requests.length,0,'Editing a sheet must not send road requests');
const first=get('#applySettings').click();assert.equal(requests.length,1);assert.equal(requests[0].body.scenery,'forest');get('#settingsDialog').onclose();assert.equal(requests.length,1,'The close event must not duplicate Apply');
await get('#applySettings').click();assert.equal(requests.length,1,'Repeated apply must not duplicate a pending request');
requests[0].resolve({ok:false,headers:{get:()=> '15'},json:async()=>({error:'ROAD_PROVIDER_RATE_LIMIT'})});await first;
assert.match(get('#resultStatus').textContent,/요청 제한/);assert.equal(context.state.recommendationLoading,false);
await get('#applySettings').click();assert.equal(requests.length,1,'Retry-After must not cause automatic or premature retries');
context.state.recommendationRetryAt=0;
const retry=get('#applySettings').click();assert.equal(requests.length,2);
requests[1].resolve({ok:true,json:async()=>({courses:[{id:'dyn-settings-test',name:'동적 테스트',estimatedMinutes:30,estimatedRoundTripKm:10,route:{status:'ROAD_ROUTED',points:[{name:'출발',type:'ORIGIN',latitude:37.5,longitude:127},{name:'복귀',type:'RETURN',latitude:37.5,longitude:127}]}}]})});await retry;
assert.equal(context.recommendations.length,1);await get('#applySettings').click();assert.equal(requests.length,2,'Unchanged successful settings need no extra request');
context.state.settingsDirty=true;const challenged=get('#applySettings').click();assert.equal(requests.length,3);
requests[2].resolve({ok:false,json:async()=>({error:'ROAD_PROVIDER_CHALLENGE'})});await challenged;
assert.match(get('#resultStatus').textContent,/보안 검증/);assert.doesNotMatch(get('#resultStatus').textContent,/초 뒤/);assert.equal(context.state.recommendationRetryAt,0);
console.log('PASS: deferred settings, explicit apply, pending-click deduplication, rate-limit cooldown, explicit retry and provider challenge feedback.');
