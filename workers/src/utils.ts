import { z } from 'zod';
// Avoid per-schema dynamic validator compilation on a cold edge isolate.
z.config({jitless:true});
export class Failure extends Error {
  constructor(public code: string, public status: 400 | 403 | 409 | 413 | 429 | 503 = 400) { super(code); }
}
export const coordinate = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export const now = () => Math.floor(Date.now() / 1000);
export const bytes = (s: string) => new TextEncoder().encode(s);
type Base64Bytes = Uint8Array & {toBase64?:(options?:{alphabet:'base64url';omitPadding:boolean})=>string};
export function b64(b: ArrayBuffer | Uint8Array): string {
  const data=(b instanceof Uint8Array?b:new Uint8Array(b)) as Base64Bytes;
  if(data.toBase64)return data.toBase64();
  let text='';
  for(let at=0;at<data.length;at+=32768)text+=String.fromCharCode(...data.subarray(at,at+32768));
  return btoa(text);
}
export function unb64(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export function url64(b: ArrayBuffer | Uint8Array): string {
  const data=(b instanceof Uint8Array?b:new Uint8Array(b)) as Base64Bytes;
  return data.toBase64?data.toBase64({alphabet:'base64url',omitPadding:true}):b64(data).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export function from64(s: string) { return unb64(s.replace(/-/g, '+').replace(/_/g, '/')); }
export const nonce = () => url64(crypto.getRandomValues(new Uint8Array(32)));
export async function hash(s: string) { return url64(await crypto.subtle.digest('SHA-256', bytes(s))); }
// Optional immutable key caches only; no OAuth/session/vehicle state is cached.
// A fresh isolate or rotated binding always imports and validates the key again.
let hmacCache:{material:string;key:Promise<CryptoKey>}|undefined;
let aesCache:{material:string;key:Promise<CryptoKey>}|undefined;
export async function hmacKey(secret: string) {
  if(hmacCache?.material===secret)return hmacCache.key;
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = unb64(secret); } catch { throw new Failure('NOT_CONFIGURED', 503); }
  if (raw.length < 32) throw new Failure('NOT_CONFIGURED', 503);
  const key=crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  hmacCache={material:secret,key};return key;
}
export async function encrypt(value: unknown, secret: string, aad: string) {
  const key = await aes(secret), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(aad) }, key, bytes(JSON.stringify(value)));
  return `${b64(iv)}.${b64(data)}`;
}
export async function decrypt<T>(value: string, secret: string, aad: string): Promise<T> {
  const [iv, data] = value.split('.');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: bytes(aad) }, await aes(secret), unb64(data)))) as T;
}
async function aes(secret: string) {
  if(aesCache?.material===secret)return aesCache.key;
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = unb64(secret); } catch { throw new Failure('NOT_CONFIGURED', 503); }
  if (raw.length !== 32) throw new Failure('NOT_CONFIGURED', 503);
  const key=crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  aesCache={material:secret,key};return key;
}
export function distance(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180, v = Math.sin((c-a)*r/2)**2 + Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;
  return 12742 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1-v)));
}
export const round = (n: number, places = 0) => Math.round(n * 10**places) / 10**places;
export function httpsBase(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Failure('NOT_CONFIGURED', 503);
  return u.href.replace(/\/+$/, '');
}
// Timeout covers reading and parsing, not only response headers. Never retry commands or refresh tokens.
export async function httpJson(url: string, init: RequestInit = {}, timeout = 10000): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
    if (Number(response.headers.get('content-length')) > 4_000_000) throw new Failure('RESPONSE_TOO_LARGE');
    const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4_000_000) { await reader.cancel(); throw new Failure('RESPONSE_TOO_LARGE'); } chunks.push(value); }
    // OSRM summary responses normally fit in one chunk. Avoid copying them.
    let raw:Uint8Array;
    if(chunks.length===1)raw=chunks[0];
    else {raw=new Uint8Array(size);let at=0;for(const chunk of chunks){raw.set(chunk,at);at+=chunk.length;}}
    let data: unknown = null; try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { /* Map HTTP status before invalid body. */ }
    return { status: response.status, data };
  } catch (e) { if (e instanceof Failure) throw e; throw new Failure(controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'SERVICE_UNAVAILABLE'); }
  finally { clearTimeout(timer); }
}
