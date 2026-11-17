// Rehydrate the public, checksummed ODbL snapshot. Local by default; no user data.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {cf,accountId} from './cloudflare-client.mjs';
import {preserveRollback} from './poi-rollback.mjs';
const args=process.argv.slice(2),remote=args.includes('--remote'),database=args.find(a=>a.startsWith('--database='))?.split('=')[1];
if(remote&&!/^[a-f0-9-]{36}$/.test(database??''))throw Error('Explicit remote database UUID required');
const directory=resolve('../dist/data'),manifest=JSON.parse(await readFile(join(directory,'poi-manifest.json'),'utf8'));
if(!manifest.datasets.every(id=>/^[a-z0-9-]{1,80}$/.test(id)))throw Error('Invalid dataset');
const platform=remote?null:await getPlatformProxy({configPath:'wrangler.local.jsonc'});
const fingerprint=createHash('sha256').update(JSON.stringify(manifest.checksums)).digest('hex').slice(0,24);
await mkdir('.wrangler/poi-import',{recursive:true});
const statePath=`.wrangler/poi-import/public-${remote?database:'local'}-${fingerprint}.json`;
let state={done:[],rowsWritten:0};try{state=JSON.parse(await readFile(statePath,'utf8'));}catch{}
async function sql(query,params=[]){
 if(!remote){const r=await platform.env.DB.prepare(query).bind(...params).all();state.rowsWritten+=r.meta.rows_written;return r.results;}
 for(let attempt=0;;attempt++)try{
  const value=await cf(`/accounts/${accountId}/d1/database/${database}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:query,params})});
  for(const r of value.result)state.rowsWritten+=r.meta?.rows_written??0;return value.result.flatMap(r=>r.results??[]);
 }catch(error){if(attempt>=4||!/(429|503|502|500)/.test(error.message))throw error;await new Promise(r=>setTimeout(r,Math.min(10000,500*2**attempt)));}
}
try{
 for(const meta of manifest.metadata){
  await sql('INSERT OR IGNORE INTO poi_datasets VALUES(?,?,?,?,?,?)',[meta.id,meta.provider,meta.created_at,meta.source_updated_at,meta.attribution,'COMPLETE']);
  await sql('INSERT OR IGNORE INTO poi_storage VALUES(?,?,?)',[meta.id,'CELLS',meta.record_count??manifest.total]);
 }
 for(const job of manifest.syncJobs??[]){
  const columns=['id','provider','started_at','finished_at','status','processed','inserted','updated','deleted','rejected','checkpoint','error'];
  await sql('INSERT OR REPLACE INTO poi_sync_jobs ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',columns.map(k=>job[k]??null));
 }
 let pending=[],cellRecords=[],cellKey=null,page=0,processed=0,cells=0;
 async function send(){
  if(!pending.length)return;
  const signature=createHash('sha256').update(JSON.stringify(pending)).digest('hex');
  if(!state.done.includes(signature)){
   await sql('INSERT OR IGNORE INTO poi_cells VALUES '+pending.map(()=>'(?,?,?,?,?,?,?)').join(','),pending.flat());
   state.done.push(signature);await writeFile(statePath,JSON.stringify(state));
  }
  pending=[];
 }
 async function emit(){
  if(!cellRecords.length)return;
  const lat=cellRecords.map(p=>p.latitude),lon=cellRecords.map(p=>p.longitude),id=cellRecords[0].dataset_id;
  pending.push([id,cellKey.slice(id.length+1),Math.min(...lat),Math.max(...lat),Math.min(...lon),Math.max(...lon),JSON.stringify(cellRecords)]);cells++;cellRecords=[];
  if(pending.length>=10)await send();
 }
 for(const file of manifest.files){
  if(!/^pois-[a-z]+\.ndjson\.gz$/.test(file))throw Error('Invalid archive name');
  if(createHash('sha256').update(await readFile(join(directory,file))).digest('hex')!==manifest.checksums[file])throw Error('Archive checksum mismatch');
  const lines=createInterface({input:createReadStream(join(directory,file)).pipe(createGunzip()),crlfDelay:Infinity});
  for await(const line of lines){
   const record=JSON.parse(line);if(!manifest.datasets.includes(record.dataset_id)||!Number.isFinite(record.latitude)||record.latitude<32||record.latitude>39.5||!Number.isFinite(record.longitude)||record.longitude<124||record.longitude>132)throw Error('Invalid POI record');
   if(!/^\d{3}:\d{4}-\d{1,5}$/.test(record.cell_id))throw Error('Invalid spatial cell');
   const key=record.dataset_id+':'+record.cell_id;delete record.cell_id;
   if(key!==cellKey){await emit();cellKey=key;page=0;}
   if(cellRecords.length>=20)throw Error('Oversized spatial cell');
   cellRecords.push(record);processed++;
  }
  await emit();
 }
 await send();if(processed!==manifest.total)throw Error('Archive record count mismatch');
 const ids=manifest.datasets.map(()=>'?').join(',');
 const count=await sql(`SELECT sum(json_array_length(records_json)) total FROM poi_cells WHERE dataset_id IN (${ids})`,manifest.datasets);
 if(Number(count[0].total)!==manifest.total)throw Error('D1 record count mismatch; not activated');
 const before=await sql('SELECT * FROM poi_provider_state');
 await preserveRollback(statePath+'.rollback.sql',before,manifest.metadata);
 for(const meta of manifest.metadata)await sql('INSERT OR REPLACE INTO poi_provider_state VALUES(?,?)',[meta.provider,meta.id]);
 console.log(JSON.stringify({activated:manifest.datasets,records:processed,cells,rowsWritten:state.rowsWritten,remote}));
}finally{await platform?.dispose();}
