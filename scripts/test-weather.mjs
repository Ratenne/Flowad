import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {requestWeather,weatherFailureMessage} from '../dist/weather-client.js';
import {weatherAt} from '../dist/engine.js';
const forecast={hourly:{time:[Math.floor(Date.now()/1000)],temperature_2m:[8],wind_speed_10m:[4],weather_code:[95]}};
const ok=()=>new Response(JSON.stringify(forecast));
let calls=0;
assert.deepEqual(await requestWeather('https://weather.test',{fetcher:async()=>{calls++;if(calls===1)throw TypeError('network');return ok();}}),forecast);assert.equal(calls,2);
calls=0;await requestWeather('https://weather.test',{fetcher:async()=>{calls++;return ok();}});assert.equal(calls,1);
calls=0;await requestWeather('https://weather.test',{fetcher:async()=>{calls++;return calls===1?new Response('',{status:503}):ok();}});assert.equal(calls,2);
for(const [status,body,code] of [[429,'rate limited','WEATHER_RATE_LIMIT'],[403,'forbidden','WEATHER_HTTP'],[200,'invalid JSON','WEATHER_INVALID']]){
 calls=0;await assert.rejects(requestWeather('https://weather.test',{fetcher:async()=>{calls++;return new Response(body,{status});}}),{code});assert.equal(calls,1);
}
calls=0;await assert.rejects(requestWeather('https://weather.test',{attemptMs:5,fetcher:(_,o)=>{calls++;return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));}}),{code:'WEATHER_TIMEOUT'});assert.equal(calls,2);
const cancel=new AbortController();calls=0;
await assert.rejects(requestWeather('https://weather.test',{signal:cancel.signal,fetcher:async()=>{calls++;cancel.abort();throw cancel.signal.reason;}}),{name:'AbortError'});assert.equal(calls,1);

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),nodes=new Map();let answer=()=>Promise.resolve(forecast),updates=0;
const context=vm.createContext({state:{location:{lat:36.3504,lng:127.3845},weatherSource:'loading',forecasts:[]},routes:[],weatherRequest:0,weatherAbort:null,AbortController,setTimeout,clearTimeout,URLSearchParams,weatherAt,weatherFailureMessage,
 requestWeather:(...args)=>answer(...args),departureTimestamp:()=>Date.now(),paintWeather(){context.paintWeatherNotice();},updateResults(){updates++;},paintLocation(){},
 toast(){},$:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',addEventListener(type,handler){this[type]=handler;}});return nodes.get(id);}
});
vm.runInContext(app.slice(app.indexOf('function paintWeatherNotice()'),app.indexOf('function updateWeather()'))+app.slice(app.indexOf('function applyOriginWeather()'),app.indexOf('function requestPreferredLocation()')),context);
await context.loadWeather();assert.equal(context.state.weatherSource,'live');assert.equal(context.state.originSevere,true);assert.equal(updates,1);
context.routes=[{id:'dynamic-public-stop',lat:36.4,lng:127.4}];answer=async()=>{throw Object.assign(Error('network'),{code:'WEATHER_NETWORK'});};
await context.loadWeather();assert.equal(context.state.weatherSource,'live');assert.equal(context.state.forecasts[0],forecast);assert.equal(context.state.originSevere,true);assert.match(nodes.get('#dataSourceLabel').textContent,/출발지 예보 적용/);
const binding=app.indexOf("$('#restoreWeather').addEventListener");vm.runInContext(app.slice(binding,app.indexOf('});renderCities();',binding)+3),context);
let reloads=0;answer=async()=>{reloads++;return [forecast,forecast];};context.$('#restoreWeather').click();await new Promise(setImmediate);assert.equal(reloads,1);assert.equal(context.state.weatherError,null);assert.equal(context.state.weatherWarning,null);assert.equal(context.state.forecasts.length,2);
answer=async()=>{throw Object.assign(Error('network'),{code:'WEATHER_NETWORK'});};context.state.forecasts=[{hourly:{...forecast.hourly,time:[1]}}];await context.loadWeather();assert.equal(context.state.weatherSource,'error');assert.equal(context.state.forecasts.length,0);
// A new origin has no reusable forecast. A failure must not resurrect the old location.
context.state.weatherSource='loading';context.state.forecasts=[];await context.loadWeather();assert.equal(context.state.weatherSource,'error');assert.equal(context.state.forecasts.length,0);assert.match(nodes.get('#dataSourceLabel').textContent,/연결 실패/);
// A late callback cannot override a manual weather selection/new location token.
let finish,pendingCalls=0;answer=()=>{pendingCalls++;return new Promise(resolve=>{finish=resolve;});};const pending=context.loadWeather();await context.loadWeather();assert.equal(pendingCalls,1);context.weatherRequest++;context.state.weatherSource='manual';finish(forecast);await pending;assert.equal(context.state.weatherSource,'manual');
answer=async()=>({hourly:{time:[1]}});await context.loadWeather();assert.equal(context.state.weatherSource,'error');assert.equal(context.state.weatherError,'예보 응답 형식 오류');
console.log('PASS: weather network/timeout retry bounds, no retry on 429/invalid data/cancellation, origin forecast preservation, severe weather, location isolation and late replies.');
