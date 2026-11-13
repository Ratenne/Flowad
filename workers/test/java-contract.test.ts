import { it,expect } from 'vitest';
import fixtures from './fixtures/java-contracts.json';
import { call,config } from './helpers';
function normalize(value:unknown):unknown{
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['generatedAt','navigationTicket','csrf','oauthStatus'].includes(k)).map(([k,v])=>[k,normalize(v)]));
  return value;
}
for(const fixture of fixtures.cases)it(`matches actual Java response: ${fixture.name}`,async()=>{
  const body='body'in fixture?fixture.body:undefined;
  const r=await call(fixture.path,body,{url:'http://127.0.0.1:18081',env:config({ALLOWED_ORIGINS:'',TESLA_CLIENT_ID:'',TESLA_CLIENT_SECRET:'',TESLA_REDIRECT_URI:'',ADDRESS_DB:undefined})});
  expect(r.status).toBe(fixture.status);
  const text=await r.text();let response:unknown=text;try{response=normalize(JSON.parse(text));}catch{/* empty body */}
  expect(response).toEqual(fixture.response);
});
