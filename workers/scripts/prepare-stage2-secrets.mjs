import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { cf,accountId } from './cloudflare-client.mjs';
import {workerName} from './production-target.mjs';
// Never replace keys if the intended Worker already exists. New keys are generated,
// not the public test keys from wrangler.local.jsonc. Exclusive file creation only.
const scripts=(await cf(`/accounts/${accountId}/workers/scripts`)).result;
if(scripts.some(s=>s.id===workerName||s.name===workerName))throw new Error('Worker already exists; inspect existing secret names instead of generating replacements.');
await mkdir('.wrangler/production',{recursive:true});
await writeFile('.wrangler/production/initial-secrets.json',JSON.stringify({TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),NAVIGATION_TICKET_SECRET:randomBytes(32).toString('base64')}),{flag:'wx',mode:0o600});
console.log('Generated two independent production-strength keys in ignored local storage. No secret values printed.');
