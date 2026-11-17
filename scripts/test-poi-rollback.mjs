import assert from 'node:assert/strict';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preserveRollback} from '../workers/scripts/poi-rollback.mjs';
const directory=await mkdtemp(join(tmpdir(),'flowad-rollback-')),file=join(directory,'rollback.sql');
try{
 await preserveRollback(file,[],[{provider:'OSM',id:'new'}]);
 const first=await readFile(file,'utf8');assert.match(first,/DELETE .*provider='OSM' AND active_dataset='new'/);
 await preserveRollback(file,[{provider:'OSM',active_dataset:'new'}],[{provider:'OSM',id:'new'}]);
 assert.equal(await readFile(file,'utf8'),first);
 await unlink(file);
 await preserveRollback(file,[{provider:'OSM',active_dataset:"previous'quoted"}],[{provider:'OSM',id:'new'}]);
 assert.match(await readFile(file,'utf8'),/previous''quoted/);
 console.log('PASS: initial-provider rollback, original recovery point across retries and SQL quoting.');
}finally{await unlink(file).catch(()=>{});await rmdir(directory);}
