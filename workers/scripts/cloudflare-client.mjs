// Uses only the operator's explicit Wrangler login. Never prints or persists tokens.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export const accountId='8840227b6eb94fdbb655f3a662bf55d8';
async function token(){
  if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
  const file=join(process.env.APPDATA,'xdg.config','.wrangler','config','default.toml');
  const content=await readFile(file,'utf8'),match=content.match(/^oauth_token\s*=\s*"([^"]+)"/m);
  if(!match)throw new Error('Wrangler authentication unavailable. Run npx wrangler login.');
  return match[1];
}
export async function cf(path,options={}){
  if(!path.startsWith('/'))throw new Error('Cloudflare API path required');
  const {raw=false,...init}=options;
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{...init,headers:{Authorization:`Bearer ${await token()}`,...init.headers},signal:AbortSignal.timeout(30000)});
  if(raw){if(!r.ok)throw new Error(`Cloudflare HTTP ${r.status}`);return r;}
  const data=await r.json();
  if(!r.ok||data.success===false)throw new Error(`Cloudflare HTTP ${r.status}; error codes: ${(data.errors??[]).map(e=>e.code).join(',')}`);
  return data;
}
