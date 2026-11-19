// CLI tools share the actual deploy config; no separate diagnostic Worker/URL.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseConfigFileTextToJson} from 'typescript';
export const workerConfig=fileURLToPath(new URL('../wrangler.jsonc',import.meta.url));
const parsed=parseConfigFileTextToJson(workerConfig,readFileSync(workerConfig,'utf8'));
if(parsed.error||parsed.config?.name!=='flowad-api')throw Error('Expected the canonical flowad-api production config.');
const config=parsed.config,frontend=new URL(config.vars.FRONTEND_URL);
export const workerName=config.name;
export const origin=frontend.origin;
export const prefix=config.vars.API_PREFIX;
export const apiBase=origin+prefix;
export const databaseId=config.d1_databases.find(b=>b.binding==='DB')?.database_id;
if(frontend.protocol!=='https:'||frontend.pathname!==prefix+'/'||!databaseId)throw Error('Production frontend/prefix/DB mismatch.');
export function productionArguments(args=process.argv.slice(2)){
 if(!args.includes('--allow-production-requests'))throw Error('This sends requests to the live flowad-api. Pass --allow-production-requests only for an explicitly intended production test.');
 return args.filter(arg=>arg!=='--allow-production-requests');
}
