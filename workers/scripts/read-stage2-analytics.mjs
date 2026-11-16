import { cf,accountId } from './cloudflare-client.mjs';
import { writeFile } from 'node:fs/promises';
const query=`query($id: string!, $start: Time!, $end: Time!){viewer{accounts(filter:{accountTag:$id}){workersInvocationsAdaptive(limit:10,filter:{scriptName:"flowad-api-stage2",datetime_geq:$start,datetime_leq:$end}){sum{requests errors subrequests} quantiles{cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99} dimensions{scriptName status}}}}}`;
const data=await cf('/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{id:accountId,start:new Date(Date.now()-3600000).toISOString(),end:new Date().toISOString()}})});
const out={observedAt:new Date().toISOString(),note:'GraphQL CPU/wall quantiles are microseconds; includes earlier deployment versions in this hour and may lag live tail.',data:data.data,errors:data.errors?.map(e=>({message:e.message}))};
await writeFile('.wrangler/stage2/analytics.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
