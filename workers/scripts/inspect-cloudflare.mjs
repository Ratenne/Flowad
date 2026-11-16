import { writeFile } from 'node:fs/promises';
import { cf,accountId as id } from './cloudflare-client.mjs';
const out={observedAt:new Date().toISOString(),accountId:id};
const get=async path=>{try{return(await cf(path)).result;}catch(e){return{blocked:e.message};}};
out.subdomain=await get(`/accounts/${id}/workers/subdomain`);
out.accountSettings=await get(`/accounts/${id}/workers/account-settings`);
const scripts=await get(`/accounts/${id}/workers/scripts`);
out.scripts=Array.isArray(scripts)?scripts.map(s=>({id:s.id,modified_on:s.modified_on,usage_model:s.usage_model})):scripts;
const zones=await get('/zones?name=ravirgo.com');
out.zones=Array.isArray(zones)?zones.map(z=>({id:z.id,name:z.name,status:z.status,plan:z.plan?.name})):zones;
if(Array.isArray(zones)&&zones[0]){
  out.routes=await get(`/zones/${zones[0].id}/workers/routes`);
  const dns=await get(`/zones/${zones[0].id}/dns_records`);
  out.dns=Array.isArray(dns)?dns.filter(d=>['ravirgo.com','www.ravirgo.com'].includes(d.name)).map(d=>({name:d.name,type:d.type,content:d.content,proxied:d.proxied})):dns;
}
const page=await get(`/accounts/${id}/pages/projects/ravirgo`);
out.pages=page.blocked?page:{name:page.name,subdomain:page.subdomain,domains:page.domains,source:page.source?.type,build_config:page.build_config,production_branch:page.production_branch};
out.settings={};
if(Array.isArray(scripts))for(const s of scripts){
  const settings=await get(`/accounts/${id}/workers/scripts/${s.id}/settings`);
  out.settings[s.id]=settings.blocked?settings:{usage_model:settings.usage_model,limits:settings.limits,observability:settings.observability,bindings:settings.bindings?.map(b=>({name:b.name,type:b.type,...(['API_PREFIX','FRONTEND_URL','TESLA_REDIRECT_URI','ALLOWED_ORIGINS'].includes(b.name)?{text:b.text}:{} )}))};
}
await writeFile('.wrangler/stage2/inventory.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
