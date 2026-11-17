import {writeFile} from 'node:fs/promises';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function preserveRollback(path,before,targets){
 const statements=targets.map(target=>{
  const previous=before.find(row=>row.provider===target.provider);
  return previous?`INSERT OR REPLACE INTO poi_provider_state VALUES(${literal(previous.provider)},${literal(previous.active_dataset)});`:
   `DELETE FROM poi_provider_state WHERE provider=${literal(target.provider)} AND active_dataset=${literal(target.id)};`;
 });
 // Resuming an import must never replace its original recovery point.
 try{await writeFile(path,statements.join('\n'),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
}
