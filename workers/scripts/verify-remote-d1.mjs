import assert from 'node:assert/strict';
import { createHash,createDecipheriv,randomUUID } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { cf,accountId } from './cloudflare-client.mjs';
const db='3a0191de-08ae-4850-8157-ccb5bf022152';
const stats=[];
async function query(sql,params=[]){const r=await cf(`/accounts/${accountId}/d1/database/${db}/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql,params})});const data=r.result[0];assert.equal(data.success,true);stats.push(data.meta);return data.results;}
const origin='https://flowad-api-stage2.o94777.workers.dev';
const r=await fetch(origin+'/flowad/api/tesla/status');assert.equal(r.status,200);const status=await r.json(),cookie=r.headers.get('set-cookie').split(';')[0],id=cookie.split('=')[1];
const key=createHash('sha256').update(id).digest('base64url');
const rows=await query('SELECT id,ciphertext,expires_at FROM sessions WHERE id=?',[key]);assert.equal(rows.length,1);assert(!JSON.stringify(rows).includes(status.csrf));assert(!JSON.stringify(rows).includes(id));
const secrets=JSON.parse(await readFile('.wrangler/stage2/initial-secrets.json','utf8'));
const [iv,encoded]=rows[0].ciphertext.split('.'),encrypted=Buffer.from(encoded,'base64'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(secrets.TOKEN_ENCRYPTION_KEY,'base64'),Buffer.from(iv,'base64'));
cipher.setAAD(Buffer.from(key));cipher.setAuthTag(encrypted.subarray(-16));const plain=Buffer.concat([cipher.update(encrypted.subarray(0,-16)),cipher.final()]);assert.equal(JSON.parse(plain).csrf,status.csrf);
const n=(await query('SELECT unixepoch() AS epoch'))[0].epoch,state='stage2-'+randomUUID(),owner=randomUUID();
await query('INSERT INTO oauth_states(hash,session_id,expires_at) VALUES(?,?,?)',[state,key,n+300]);
const consumes=await Promise.all([query('DELETE FROM oauth_states WHERE hash=? AND session_id=? AND expires_at>? RETURNING hash',[state,key,n]),query('DELETE FROM oauth_states WHERE hash=? AND session_id=? AND expires_at>? RETURNING hash',[state,key,n])]);assert.equal(consumes.flat().length,1);
const first=await query('UPDATE sessions SET lock_owner=?,lock_until=? WHERE id=? AND expires_at>? AND lock_until<? RETURNING id',[owner,n+120,key,n,n]);assert.equal(first.length,1);
const second=await query('UPDATE sessions SET lock_owner=?,lock_until=? WHERE id=? AND expires_at>? AND lock_until<? RETURNING id',['other-owner',n+120,key,n,n]);assert.equal(second.length,0);
await query('UPDATE sessions SET lock_owner=NULL,lock_until=0 WHERE id=? AND lock_owner=?',[key,owner]);
const expired='stage2-expired-'+randomUUID();await query('INSERT INTO oauth_states(hash,session_id,expires_at) VALUES(?,?,?)',[expired,key,n-1]);assert.equal((await query('DELETE FROM oauth_states WHERE hash=? AND session_id=? AND expires_at>? RETURNING hash',[expired,key,n])).length,0);
await query('DELETE FROM oauth_states WHERE expires_at<=? AND session_id=?',[n,key]);assert.equal((await query('SELECT hash FROM oauth_states WHERE session_id=?',[key])).length,0);
// Remove only the disposable session created by this script; no other user data touched.
await query('DELETE FROM sessions WHERE id=?',[key]);
const schema=await query("SELECT name,type FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name");
const out={observedAt:new Date().toISOString(),database:db,status:'REAL_API_VERIFIED',checks:{remoteReadWrite:true,encryptedSessionRoundTrip:true,noPlaintextCsrfOrCookie:true,atomicStateSingleConsumption:true,leaseExclusion:true,stateExpiry:true,expiredOwnRecordCleanup:true},schema,queryCount:stats.length,rowsRead:stats.reduce((n,m)=>n+(m.rows_read??0),0),rowsWritten:stats.reduce((n,m)=>n+(m.rows_written??0),0)};
await writeFile('.wrangler/stage2/d1-verification.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
