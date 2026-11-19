import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {workerName,workerConfig,origin,prefix,apiBase,databaseId,productionArguments} from '../workers/scripts/production-target.mjs';
assert.equal(workerName,'flowad-api');assert.equal(origin,'https://ravirgo.com');assert.equal(prefix,'/flowad');assert.equal(apiBase,'https://ravirgo.com/flowad');
assert.equal(databaseId,'3a0191de-08ae-4850-8157-ccb5bf022152');assert.ok(workerConfig.endsWith('wrangler.jsonc'));
assert.throws(()=>productionArguments([]),/live flowad-api/);
assert.deepEqual(productionArguments(['baseline','--allow-production-requests','1']),['baseline','1']);
await assert.rejects(access(new URL('../workers/wrangler.stage2.jsonc',import.meta.url)));
const directory=new URL('../workers/scripts/',import.meta.url);
for(const name of await readdir(directory)){
 if(!name.endsWith('.mjs'))continue;
 const source=await readFile(new URL(name,directory),'utf8');
 assert.doesNotMatch(source,/https:\/\/flowad-api-stage2\.|workers\/scripts\/flowad-api-stage2|wrangler\.stage2\.jsonc/,name+' must not target the retired Worker/config');
 assert.doesNotMatch(source,/flowad-api-stage2/,name+' must use the canonical target');
}
// These scripts must stop before Cloudflare authentication, tailing or D1 writes.
for(const name of ['measure-recommendation-cpu.mjs','measure-stage2.mjs','profile-cloudflare-cpu.mjs','verify-remote-d1.mjs']){
 const entry=new URL(name,directory).href;
 const code=`globalThis.fetch=()=>{throw Error('NETWORK_DISABLED_IN_TEST');};await import(${JSON.stringify(entry)});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000,env:{...process.env,CLOUDFLARE_API_TOKEN:'',FLOWAD_TEST_SECRETS_FILE:'',APPDATA:'nonexistent-test-credentials'}});
 assert.notEqual(result.status,0,name);assert.match(result.stderr,/allow-production/,name+' must refuse before reading credentials');
}
const frontend=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');assert.doesNotMatch(frontend,/flowad-api-stage2/);assert.match(frontend,/fetch\('\.\/api\/recommendations'/);
console.log('PASS: canonical Worker/URL/config/DB, no executable retired-target references, explicit production-test guards and same-origin frontend requests.');
