// Read-only local reference capture. Never contacts Tesla, Cloudflare or a road provider.
// Start Java with external integrations explicitly blank (see MIGRATION.md).
import { writeFile } from 'node:fs/promises';
const origin='http://127.0.0.1:18081';
const base={latitude:37.5665,longitude:126.978,availableMinutes:180,scenery:'forest',vehicleType:'ev'};
const weather={condition:'sunny',temperatureC:30,windMps:2,severe:false,source:'contract fixture',observedAt:'2026-11-12T00:00:00Z'};
const requests=[
  ['seoul','/api/recommendations',base],
  ['busan','/api/recommendations',{...base,latitude:35.1796,longitude:129.0756}],
  ['gangneung','/api/recommendations',{...base,latitude:37.7519,longitude:128.8761,availableMinutes:360,scenery:'all',walking:false,vehicleType:'ice'}],
  ['hot-sunset','/api/recommendations',{...base,availableMinutes:500,scenery:'coast',batteryPercent:10,estimatedRangeKm:400,departure:'sunset',weather}],
  ['severe','/api/recommendations',{...base,originSevere:true}],
  ['short','/api/recommendations',{...base,availableMinutes:1}],
  ['return','/api/recommendations',{...base,availableMinutes:1440,returnLatitude:35.1796,returnLongitude:129.0756,walking:false}],
  ['course-weather','/api/recommendations',{...base,availableMinutes:500,weather,courseWeather:{yangpyeong:{...weather,severe:true},paju:{...weather,condition:'rainy'}}}],
  ['invalid','/api/recommendations',{}],
  ['invalid-coordinate','/api/recommendations',{...base,latitude:91}],
  ['charging-required','/api/charging/recommendations',{}],
  ['charging-mock','/api/charging/recommendations',{routeStatus:'ROAD_ROUTED',geometry:[{latitude:37.56,longitude:127},{latitude:37.57,longitude:127}]}],
  ['address-unconfigured','/api/location/address',{latitude:37.5,longitude:127}],
  ['address-invalid','/api/location/address',{latitude:91,longitude:127}],
  ['resolve-invalid','/api/navigation/resolve',{ticket:'invalid'}],
  ['tesla-status','/api/tesla/status',undefined],
  ...['authorize','disconnect','vehicles','select','reading','location','navigation/preview','navigation/destination/preview','navigation/send','navigation/confirm'].map(p=>['tesla-'+p,'/api/tesla/'+p,{}]),
  ['tesla-callback','/api/tesla/callback?state=invalid&code=invalid',undefined]
];
export function normalize(value){
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['generatedAt','navigationTicket','csrf'].includes(k)).map(([k,v])=>[k,normalize(v)]));
  return value;
}
const cases=[];
for(const [name,path,body]of requests){
  const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let response=text;try{response=normalize(JSON.parse(text));}catch{/* Empty legacy responses remain empty. */}
  cases.push({name,path,...(body===undefined?{}:{body}),status:r.status,response});
}
await writeFile(new URL('../test/fixtures/java-contracts.json',import.meta.url),JSON.stringify({source:'Unmodified Spring Boot 3.5.7 / Java 17; local HTTP; no external providers',cases},null,2)+'\n');
console.log(`Captured ${cases.length} Java HTTP contracts from loopback only.`);
