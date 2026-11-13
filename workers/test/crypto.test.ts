import {it,expect} from 'vitest';
import {encrypt,decrypt,hmacKey,bytes,b64,url64,unb64,from64} from '../src/utils';
const a='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',b='AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
it('keeps native Base64 byte-for-byte compatible with legacy tickets and binary subarrays',()=>{
  const raw=Uint8Array.from({length:256},(_,i)=>i),expected=btoa(String.fromCharCode(...raw));
  expect(b64(raw)).toBe(expected);expect(url64(raw)).toBe(expected.replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'));
  expect(unb64(b64(raw))).toEqual(raw);expect(from64(url64(raw))).toEqual(raw);
  expect(b64(raw.subarray(251))).toBe(btoa(String.fromCharCode(...raw.subarray(251))));
});
it('keeps cached keys isolated after rotation and binds ciphertext to the session',async()=>{
  const old=await encrypt({value:'public test'},a,'session-a');
  await encrypt({value:'public test'},b,'session-b');
  expect(await decrypt(old,a,'session-a')).toEqual({value:'public test'});
  await expect(decrypt(old,b,'session-a')).rejects.toThrow();
  await expect(decrypt(old,a,'session-b')).rejects.toThrow();
  const signature=await crypto.subtle.sign('HMAC',await hmacKey(a),bytes('test'));
  expect(await crypto.subtle.verify('HMAC',await hmacKey(b),signature,bytes('test'))).toBe(false);
  expect(await crypto.subtle.verify('HMAC',await hmacKey(a),signature,bytes('test'))).toBe(true);
});
it('still rejects invalid bindings after warming the immutable-key cache',async()=>{
  await hmacKey(a);await encrypt({},a,'test');
  await expect(hmacKey('invalid')).rejects.toMatchObject({code:'NOT_CONFIGURED'});
  await expect(encrypt({},'invalid','test')).rejects.toMatchObject({code:'NOT_CONFIGURED'});
});
