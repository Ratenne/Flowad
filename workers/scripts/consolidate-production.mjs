// Verify the already-consolidated production Worker and its immutable bindings.
// Never recreate or rename a retired staging Worker, or read secret values.
import {mkdir,writeFile} from 'node:fs/promises';
import {cf,accountId} from './cloudflare-client.mjs';
const prefix=`/accounts/${accountId}`,sourceId='0b7a18d798b84d70b94ff8a276b605b9';
const routesPath='/zones/ea76e54e6de2bbd66dbe3f9225ae3485/workers/routes';
if(process.argv[2]!=='--apply')throw Error('Use --apply only for the requested production consolidation.');
const source=(await cf(`${prefix}/workers/workers/${sourceId}`)).result;
if(source.name!=='flowad-api')throw Error('Expected the already-consolidated flowad-api Worker; no automatic legacy rename.');
const matches=(await cf(routesPath)).result.filter(route=>route.pattern==='ravirgo.com/flowad*');
if(matches.length!==1)throw Error('Expected exactly one production route');
const route=matches[0],routePath=routesPath+'/'+route.id;
if(route.pattern!=='ravirgo.com/flowad*'||route.script!=='flowad-api')throw Error('Unexpected production route');
const before=(await cf(`${prefix}/workers/scripts/${source.name}/settings`)).result;
const required=['TOKEN_ENCRYPTION_KEY','NAVIGATION_TICKET_SECRET','TESLA_CLIENT_ID','TESLA_CLIENT_SECRET','JUSO_MAP_API_KEY'];
if(required.some(name=>!before.bindings.some(b=>b.name===name&&b.type==='secret_text')))throw Error('Production secret binding missing');
if(!before.bindings.some(b=>b.name==='DB'&&b.id==='3a0191de-08ae-4850-8157-ccb5bf022152'))throw Error('Unexpected production database');
await mkdir('.wrangler/production-migration',{recursive:true});
await writeFile('.wrangler/production-migration/before.json',JSON.stringify({sourceId,name:source.name,route,bindingNames:before.bindings.map(b=>({name:b.name,type:b.type}))},null,2),{mode:0o600});
const currentRoute=(await cf(routePath)).result;
if(currentRoute.script!=='flowad-api')await cf(routePath,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({pattern:route.pattern,script:'flowad-api',request_limit_fail_open:false})});
const after=(await cf(`${prefix}/workers/scripts/flowad-api/settings`)).result;
if(required.some(name=>!after.bindings.some(b=>b.name===name&&b.type==='secret_text')))throw Error('Secret binding verification failed');
if(!after.bindings.some(b=>b.name==='DB'&&b.id==='3a0191de-08ae-4850-8157-ccb5bf022152'))throw Error('Database binding verification failed');
const status=await fetch('https://ravirgo.com/flowad/api/tesla/status',{signal:AbortSignal.timeout(15000)});
const data=await status.json();if(status.status!==200||!data.secure)throw Error('Production smoke failed');
console.log(JSON.stringify({worker:'flowad-api',sameWorkerId:true,route:'ravirgo.com/flowad*',sameDatabase:true,secretsPreserved:true,status:status.status}));
