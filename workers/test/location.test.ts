import { it,expect,vi } from 'vitest';
import { config,call,external } from './helpers';
import {parseJusoAddress,jusoAddressUrl} from '../src/juso-address';
const jusoPayload=(items='',code='0',count=items?'1':'0')=>`flowadJuso({'returnXml':'<results><common><errorCode>${code}</errorCode><totalCount>${count}</totalCount></common>${items}</results>'})`;
const jusoEnv=()=>config({JUSO_MAP_API_KEY:'test+key='});
it('looks up projected coordinates through Juso with the map key, without any address database',async()=>{
  const fn=external((url,init)=>{
    expect(url).toBe(jusoAddressUrl);expect(init?.method).toBe('POST');expect(init?.redirect).toBe('manual');
    const form=new URLSearchParams(String(init?.body));
    expect(form.get('confmKey')).toBe('test+key=');expect(form.get('searchType')).toBe('1');
    expect(Number(form.get('pointX'))).toBeCloseTo(1000000,2);expect(Number(form.get('pointY'))).toBeCloseTo(2000000,2);
    return new Response(jusoPayload('<juso><roadAddrPart1>테스트로 1 &amp; 2</roadAddrPart1><bdNm>미확인 건물</bdNm></juso>'));
  });
  const r=await call('/api/location/address',{latitude:38,longitude:127.5},{env:jusoEnv()});
  expect(r.status).toBe(200);expect(await r.json()).toEqual({label:'테스트로 1 & 2',type:'ROAD_ADDRESS',source:'JUSO_MAP'});
  expect(r.headers.get('Cache-Control')).toContain('no-store');expect(fn).toHaveBeenCalledTimes(1);
});
it('distinguishes no match, unsupported coordinates, invalid input and missing key',async()=>{
  const fn=external(()=>new Response(jusoPayload()));
  expect((await call('/api/location/address',{latitude:38,longitude:127.5},{env:jusoEnv()})).status).toBe(204);
  expect((await call('/api/location/address',{latitude:50,longitude:10},{env:jusoEnv()})).status).toBe(204);
  expect((await call('/api/location/address',{latitude:91,longitude:127},{env:jusoEnv()})).status).toBe(400);
  const r=await call('/api/location/address',{latitude:38,longitude:127.5},{env:config({JUSO_MAP_API_KEY:''})});
  expect(r.status).toBe(503);expect(r.headers.get('X-Flowad-Status')).toBe('JUSO_NOT_CONFIGURED');expect(fn).toHaveBeenCalledTimes(1);
});
it('rejects unapproved keys, malformed JSONP/XML, executable payloads and entity declarations',async()=>{
  for(const [raw,code] of [[jusoPayload('','E0001'),'JUSO_KEY_REJECTED'],[jusoPayload('','E9999'),'JUSO_REQUEST_REJECTED'],['<html>bad gateway</html>','JUSO_INVALID_RESPONSE'],['flowadJuso(alert(1))','JUSO_INVALID_RESPONSE'],[jusoPayload('<juso/>'),'JUSO_INVALID_RESPONSE'],[jusoPayload('<!DOCTYPE x [<!ENTITY x "secret">]>'),'JUSO_INVALID_RESPONSE']]){
    external(()=>new Response(raw));
    const r=await call('/api/location/address',{latitude:38,longitude:127.5},{env:jusoEnv()});
    expect(r.status).toBe(503);expect(r.headers.get('X-Flowad-Status')).toBe(code);expect(await r.text()).toBe('');
  }
  expect(parseJusoAddress(jusoPayload('<juso><roadAddr><![CDATA[테스트로 3]]></roadAddr></juso>'))?.label).toBe('테스트로 3');
});
it('bounds upstream responses, rejects redirects and handles unavailable and timed out requests',async()=>{
  for(const response of [new Response(null,{status:302,headers:{Location:'https://example.test'}}),new Response('x'.repeat(262145))]){
    external(()=>response);expect((await call('/api/location/address',{latitude:38,longitude:127.5},{env:jusoEnv()})).status).toBe(503);
  }
  external(()=>{throw Error('network failure');});
  const failed=await call('/api/location/address',{latitude:38,longitude:127.5},{env:jusoEnv()});expect(failed.headers.get('X-Flowad-Status')).toBe('JUSO_UNAVAILABLE');
  vi.useFakeTimers();
  try{
    external((_,init)=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
    const pending=call('/api/location/address',{latitude:38,longitude:127.5},{env:jusoEnv()});
    await vi.advanceTimersByTimeAsync(3100);const r=await pending;expect(r.headers.get('X-Flowad-Status')).toBe('JUSO_TIMEOUT');
  }finally{vi.useRealTimers();}
});
it('keeps Juso form HTML, EPSG:5179 conversion, escaping and sandbox without making an HTTP call',async()=>{
  const worker=(await import('../src/index')).default;
  const r=await worker.fetch(new Request('https://flowad.test/api/location/juso-map',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'latitude=38&longitude=127.5'}),config({JUSO_MAP_API_KEY:'test+key='}),{} as ExecutionContext);
  expect(r.status).toBe(200);expect(r.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts');const html=await r.text();expect(html).toContain('confmKey=test%2Bkey%3D');expect(html).toContain('&amp;searchType=1&amp;pointX=1000000&amp;pointY=2000000');
});
