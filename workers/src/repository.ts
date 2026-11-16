import type { Env, Session } from './types';
import { decrypt, encrypt, Failure, hash, nonce, now } from './utils';

// D1 primary reads only: no read replication/bookmarks for auth decisions.
// A bounded lease serializes a browser's token rotation, selection and command plans.
export class Sessions {
  constructor(private env: Env) {}
  async create(data: Session = { csrf: nonce(), vehicles: {} }): Promise<string> {
    const id = nonce(), key = await hash(id);
    await this.env.DB.prepare('INSERT INTO sessions(id,ciphertext,expires_at) VALUES(?,?,?)')
      .bind(key, await encrypt(data, this.env.TOKEN_ENCRYPTION_KEY, key), now()+1800).run();
    return id;
  }
  async open(id: string): Promise<Lease> {
    if (!/^[\w-]{43}$/.test(id)) throw new Failure('NOT_CONNECTED');
    const key = await hash(id), owner = nonce();
    const row = await this.env.DB.prepare('UPDATE sessions SET lock_owner=?,lock_until=? WHERE id=? AND expires_at>? AND lock_until<? RETURNING ciphertext')
      .bind(owner, now()+120, key, now(), now()).first<{ciphertext: string}>();
    if (!row) {
      const exists = await this.env.DB.prepare('SELECT id FROM sessions WHERE id=? AND expires_at>?').bind(key, now()).first();
      throw new Failure(exists ? 'SESSION_BUSY' : 'NOT_CONNECTED', exists ? 409 : 400);
    }
    try { return new Lease(this.env, key, owner, await decrypt<Session>(row.ciphertext, this.env.TOKEN_ENCRYPTION_KEY, key)); }
    catch { await this.env.DB.prepare('DELETE FROM sessions WHERE id=? AND lock_owner=?').bind(key, owner).run(); throw new Failure('REAUTH_REQUIRED'); }
  }
}
export class Lease {
  private deleted = false;
  constructor(private env: Env, public key: string, private owner: string, public data: Session) {}
  async save(release = false) {
    if (this.deleted) return;
    const r = await this.env.DB.prepare('UPDATE sessions SET ciphertext=?,expires_at=?,lock_owner=?,lock_until=? WHERE id=? AND lock_owner=? AND lock_until>?')
      .bind(await encrypt(this.data, this.env.TOKEN_ENCRYPTION_KEY, this.key), now()+1800, release ? null : this.owner, release ? 0 : now()+120, this.key, this.owner, now()).run();
    if (r.meta.changes !== 1) throw new Failure('SESSION_BUSY', 409);
  }
  async remove() {
    await this.env.DB.batch([
      this.env.DB.prepare('DELETE FROM oauth_states WHERE session_id=?').bind(this.key),
      this.env.DB.prepare('DELETE FROM sessions WHERE id=? AND lock_owner=?').bind(this.key, this.owner)
    ]);
    this.deleted = true;
  }
  async state(value: string) {
    await this.env.DB.batch([
      this.env.DB.prepare('DELETE FROM oauth_states WHERE session_id=?').bind(this.key),
      this.env.DB.prepare('INSERT INTO oauth_states(hash,session_id,expires_at) VALUES(?,?,?)').bind(await hash(value), this.key, now()+300)
    ]);
  }
  async consumeState(value: string) {
    const consumed = await this.env.DB.prepare('DELETE FROM oauth_states WHERE hash=? AND session_id=? AND expires_at>? RETURNING hash')
      .bind(await hash(value), this.key, now()).first();
    if (!consumed) throw new Failure('INVALID_STATE');
  }
}
export async function quota(env: Env, identity: string, limit: number) {
  const minute = Math.floor(now()/60), id = await hash(`${env.NAVIGATION_TICKET_SECRET}:${identity}:${minute}`);
  const row = await env.DB.prepare('INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count<? RETURNING count')
    .bind(id, (minute+2)*60, limit).first();
  if (!row) throw new Failure('RATE_LIMIT', 429);
}
export async function cleanup(env: Env) {
  // Bounded deletes prevent an unbounded cron CPU/row write burst.
  for (const table of ['sessions', 'oauth_states', 'rate_limits'])
    await env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at<=? LIMIT 500)`).bind(now()).run();
}
