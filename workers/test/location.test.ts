import { it,expect } from 'vitest';
import { config,call } from './helpers';
import { geometry,measure } from '../src/location';
function polygon(rings:[number,number][][]){const bytes=new ArrayBuffer(9+rings.reduce((n,r)=>n+4+r.length*16,0)),v=new DataView(bytes);let at=0;v.setUint8(at++,1);v.setUint32(at,3,true);at+=4;v.setUint32(at,rings.length,true);at+=4;for(const ring of rings){v.setUint32(at,ring.length,true);at+=4;for(const [x,y] of ring){v.setFloat64(at,x,true);v.setFloat64(at+8,y,true);at+=16;}}return bytes;}
const box:[number,number][]=[[127,37],[127.001,37],[127.001,37.001],[127,37.001],[127,37]];
it('decodes WKB and handles polygon holes, coverage and 25m boundary',()=>{
  const raw=polygon([box]),g=geometry(raw);expect(measure(g,[127.0005,37.0005]).covers).toBe(true);expect(measure(g,[127,37]).covers).toBe(true);expect(measure(g,[127.0011,37.0005]).nearest).toBeLessThan(25);expect(measure(g,[127.002,37.0005]).nearest).toBeGreaterThan(25);
  const hole:[number,number][]=[[127.0002,37.0002],[127.0008,37.0002],[127.0008,37.0008],[127.0002,37.0008],[127.0002,37.0002]];expect(measure(geometry(polygon([box,hole])),[127.0005,37.0005]).covers).toBe(false);expect(()=>geometry(raw.slice(0,6))).toThrow();
});
it('queries optional local address D1 with existing response priorities, empty and unconfigured states',async()=>{
  const e=config();await e.ADDRESS_DB!.exec('CREATE TABLE place(id INTEGER PRIMARY KEY,name TEXT,address TEXT,shape BLOB); CREATE TABLE bounds(id INTEGER PRIMARY KEY,west REAL,east REAL,south REAL,north REAL);');
  await e.ADDRESS_DB!.prepare('INSERT INTO place VALUES(1,?,?,?)').bind('Public test building','Public test street',polygon([box])).run();await e.ADDRESS_DB!.prepare('INSERT INTO bounds VALUES(1,127,127.001,37,37.001)').run();
  const r=await call('/api/location/address',{latitude:37.0005,longitude:127.0005},{env:e});expect(await r.json()).toEqual({label:'Public test building',type:'BUILDING'});
  const near=await call('/api/location/address',{latitude:37.0005,longitude:127.0011},{env:e});expect(await near.json()).toEqual({label:'Public test street',type:'NEARBY_ADDRESS'});
  expect((await call('/api/location/address',{latitude:38,longitude:128},{env:e})).status).toBe(204);
  expect((await call('/api/location/address',{latitude:37,longitude:127},{env:config({ADDRESS_DB:undefined})})).status).toBe(503);
});
it('keeps Juso form HTML, EPSG:5179 conversion, escaping and sandbox without making an HTTP call',async()=>{
  const worker=(await import('../src/index')).default;
  const r=await worker.fetch(new Request('https://flowad.test/api/location/juso-map',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'latitude=38&longitude=127.5'}),config({JUSO_MAP_API_KEY:'test+key='}),{} as ExecutionContext);
  expect(r.status).toBe(200);expect(r.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts');const html=await r.text();expect(html).toContain('confmKey=test%2Bkey%3D');expect(html).toContain('&amp;searchType=1&amp;pointX=1000000&amp;pointY=2000000');
});
