// Explicit local by default. Remote requires --remote, exact database ID and an export manifest.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {getPlatformProxy} from 'wrangler';
import {cf,accountId} from './cloudflare-client.mjs';
import {preserveRollback} from './poi-rollback.mjs';
const args=process.argv.slice(2),remote=args.includes('--remote'),directory=resolve(args[0]??'../data/generated/d1');
const database=args.find(a=>a.startsWith('--database='))?.split('=')[1];
if(remote&&!/^[a-f0-9-]{36}$/.test(database??''))throw Error('Remote load requires an explicit database UUID');
const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
if(!manifest.datasets.every(id=>/^[a-z0-9-]{1,80}$/.test(id)))throw Error('Invalid dataset identifier');
const local=remote?null:await getPlatformProxy({configPath:'wrangler.local.jsonc'});
await mkdir('.wrangler/poi-import',{recursive:true});
const checkpointPath=join('.wrangler/poi-import',`${remote?database:'local'}-${manifest.datasets.join('_')}.json`);
let checkpoint={done:{},rowsWritten:0};try{checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));if(Array.isArray(checkpoint.done))checkpoint={done:{},rowsWritten:0};}catch{/* New import */}
async function query(sql){
 if(remote){const data=await cf(`/accounts/${accountId}/d1/database/${database}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql})});return data.result.flatMap(r=>r.results??[]);}
 return (await local.env.DB.prepare(sql).all()).results;
}
for(const [file,sha] of Object.entries(manifest.files)){
 const sql=await readFile(join(directory,file),'utf8');
 if(createHash('sha256').update(sql).digest('hex')!==sha)throw Error('Export checksum mismatch');
 if(checkpoint.done[file]===sha)continue;
 if(remote)await query(sql);
 else{
  const statements=sql.split('\n').filter(line=>line.trim()).map(line=>local.env.DB.prepare(line));
  for(let at=0;at<statements.length;at+=50){const results=await local.env.DB.batch(statements.slice(at,at+50));checkpoint.rowsWritten+=results.reduce((sum,r)=>sum+r.meta.rows_written,0);}
 }
 checkpoint.done[file]=sha;await writeFile(checkpointPath,JSON.stringify(checkpoint));
 if(Object.keys(checkpoint.done).length%20===0)console.log(`Imported ${Object.keys(checkpoint.done).length}/${Object.keys(manifest.files).length} chunks`);
}
const expected=manifest.stats.total;
const ids=manifest.datasets.map(id=>"'"+id.replaceAll("'","''")+"'").join(',');
const rows=await query(manifest.format==='CELLS'?`SELECT sum(json_array_length(records_json)) total FROM poi_cells WHERE dataset_id IN (${ids})`:`SELECT count(*) total FROM pois WHERE dataset_id IN (${ids})`);
if(Number(rows[0].total)!==expected)throw Error('Snapshot count mismatch; activation refused');
const integrity=await query('PRAGMA foreign_key_check');if(integrity.length)throw Error('Foreign key check failed');
const previous=await query('SELECT * FROM poi_provider_state');
const targets=await query(`SELECT provider,id FROM poi_datasets WHERE id IN (${ids})`);
await preserveRollback(checkpointPath+'.rollback.sql',previous,targets);
for(const sql of (await readFile(join(directory,'activate.sql'),'utf8')).split('\n').filter(Boolean))await query(sql);
console.log(JSON.stringify({activated:manifest.datasets,rows:expected,remote,rowsWritten:checkpoint.rowsWritten}));
await local?.dispose();
