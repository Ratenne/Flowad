// Explicit local by default. Remote requires --remote, exact database ID and an export manifest.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cf,accountId} from './cloudflare-client.mjs';
const args=process.argv.slice(2),remote=args.includes('--remote'),directory=resolve(args[0]??'../data/generated/d1');
const database=args.find(a=>a.startsWith('--database='))?.split('=')[1];
if(remote&&!/^[a-f0-9-]{36}$/.test(database??''))throw Error('Remote load requires an explicit database UUID');
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
await mkdir('.wrangler/poi-import',{recursive:true});
const checkpointPath=join('.wrangler/poi-import',`${remote?database:'local'}-${manifest.datasets.join('_')}.json`);
let checkpoint={done:[]};try{checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));}catch{/* New import */}
async function query(sql){
 if(remote){const data=await cf(`/accounts/${accountId}/d1/database/${database}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql})});return data.result.flatMap(r=>r.results??[]);}
 const child=spawnSync('npx.cmd',['wrangler','d1','execute','flowad','--local','--config','wrangler.local.jsonc','--json','--command',sql],{encoding:'utf8',shell:true,windowsHide:true});
 if(child.status!==0)throw Error('Local D1 query failed');
 const text=child.stdout.slice(child.stdout.indexOf('['));return JSON.parse(text).flatMap(r=>r.results??[]);
}
for(const [file,sha] of Object.entries(manifest.files)){
 const sql=await readFile(join(directory,file),'utf8');
 if(createHash('sha256').update(sql).digest('hex')!==sha)throw Error('Export checksum mismatch');
 if(checkpoint.done.includes(file))continue;
 if(remote)await query(sql);
 else{
  const child=spawnSync('npx.cmd',['wrangler','d1','execute','flowad','--local','--config','wrangler.local.jsonc','--file',join(directory,file)],{stdio:'pipe',shell:true,windowsHide:true});
  if(child.status!==0)throw Error(`Local D1 import failed at ${file}`);
 }
 checkpoint.done.push(file);await writeFile(checkpointPath,JSON.stringify(checkpoint));
 if(checkpoint.done.length%20===0)console.log(`Imported ${checkpoint.done.length}/${Object.keys(manifest.files).length} chunks`);
}
const expected=manifest.stats.total;
const ids=manifest.datasets.map(id=>"'"+id.replaceAll("'","''")+"'").join(',');
const rows=await query(`SELECT count(*) total FROM pois WHERE dataset_id IN (${ids})`);
if(Number(rows[0].total)!==expected)throw Error('Snapshot count mismatch; activation refused');
const integrity=await query('PRAGMA foreign_key_check');if(integrity.length)throw Error('Foreign key check failed');
const previous=await query('SELECT * FROM poi_provider_state');
await writeFile(checkpointPath+'.rollback.sql',previous.map(r=>`INSERT OR REPLACE INTO poi_provider_state VALUES('${r.provider}','${r.active_dataset}');`).join('\n'));
await query(await readFile(join(directory,'activate.sql'),'utf8'));
console.log(JSON.stringify({activated:manifest.datasets,rows:expected,remote}));
