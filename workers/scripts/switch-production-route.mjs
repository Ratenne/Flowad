// Run ONLY after the user has approved the concrete production cutover report.
// This changes one existing route, never DNS, Pages, Render or the old proxy code.
import { cf } from './cloudflare-client.mjs';
const zone='ea76e54e6de2bbd66dbe3f9225ae3485',id='149c7878f8e8418b8764bf6783402df1',pattern='ravirgo.com/flowad*';
const mode=process.argv[2];
if(!['--approved-cutover','--rollback'].includes(mode))throw new Error('Choose --approved-cutover only after explicit user approval, or --rollback to restore Render routing.');
const before=(await cf(`/zones/${zone}/workers/routes/${id}`)).result;
if(before.pattern!==pattern||!['flowad-path-proxy','flowad-api-stage2'].includes(before.script))throw new Error('Unexpected live route; refusing to overwrite another configuration.');
if(mode==='--approved-cutover'){
  const ready=(await cf('/accounts/8840227b6eb94fdbb655f3a662bf55d8/workers/scripts/flowad-api-stage2/settings')).result;
  const vars=Object.fromEntries(ready.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
  if(vars.FRONTEND_URL!=='https://ravirgo.com/flowad/'||vars.TESLA_REDIRECT_URI!=='https://ravirgo.com/flowad/api/tesla/callback'||vars.API_PREFIX!=='/flowad')throw new Error('Production frontend/callback/prefix must be explicitly prepared before cutover.');
  if(vars.FREE_PLAN_MODE!=='true')throw new Error('Explicit free-plan payload guard is required.');
  const secrets=new Set(ready.bindings.filter(b=>b.type==='secret_text').map(b=>b.name));
  for(const name of ['TOKEN_ENCRYPTION_KEY','NAVIGATION_TICKET_SECRET','TESLA_CLIENT_ID','TESLA_CLIENT_SECRET'])if(!secrets.has(name))throw new Error('Required secret binding missing: '+name);
  if(!ready.bindings.some(b=>b.type==='d1'&&b.name==='DB'&&b.id==='3a0191de-08ae-4850-8157-ccb5bf022152'))throw new Error('Unexpected production D1 binding.');
  const health=await fetch('https://flowad-api-stage2.o94777.workers.dev/flowad/api/tesla/status',{signal:AbortSignal.timeout(15000)});
  if(health.status!==200)throw new Error('Live session/D1 smoke check failed. Route not changed.');
}
const target=mode==='--rollback'?'flowad-path-proxy':'flowad-api-stage2';
await cf(`/zones/${zone}/workers/routes/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({pattern,script:target,request_limit_fail_open:false})});
const after=(await cf(`/zones/${zone}/workers/routes/${id}`)).result;
if(after.script!==target)throw new Error('Route verification failed');
console.log(JSON.stringify({pattern,previous:before.script,current:after.script,verified:true}));
