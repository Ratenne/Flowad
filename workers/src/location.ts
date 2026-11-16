import { Hono } from 'hono';
import proj4 from 'proj4';
import type { Bindings } from './types';
import { coordinate } from './utils';
import { JusoFailure,lookupJusoAddress } from './juso-address';
const escapeHtml=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
export const locations=new Hono<Bindings>();
locations.post('/address',async c=>{
  const raw:unknown=await c.req.json().catch(()=>null),parsed=coordinate.safeParse(raw);
  if(!parsed.success)return c.body(null,400);
  const {latitude:lat,longitude:lon}=parsed.data;
  if(!(lat>=32&&lat<=40&&lon>=124&&lon<=132))return c.body(null,204);
  const key=c.env.JUSO_MAP_API_KEY?.trim();
  if(!key||! /^[A-Za-z0-9._+/=-]+$/.test(key)){c.header('X-Flowad-Status','JUSO_NOT_CONFIGURED');return c.body(null,503);}
  try{
    const match=await lookupJusoAddress(key,lat,lon);
    return match?c.json(match):c.body(null,204);
  }catch(e){c.header('X-Flowad-Status',e instanceof JusoFailure?e.message:'JUSO_UNAVAILABLE');return c.body(null,503);}
});
locations.post('/juso-map',async c=>{
  const form=await c.req.parseBody(),lat=Number(form.latitude),lon=Number(form.longitude);
  let status:200|400|503=200,body='';
  if(!form.latitude||!form.longitude||!(lat>=32&&lat<=40&&lon>=124&&lon<=132)){status=400;body='<p>국내 위치의 좌표를 확인해 주세요.</p>';}
  else if(!c.env.JUSO_MAP_API_KEY||! /^[A-Za-z0-9._+/=-]+$/.test(c.env.JUSO_MAP_API_KEY)){status=503;body='<p>공식 주소 지도를 사용할 수 없어요.</p>';}
  else{
    const [x,y]=proj4('+proj=longlat +datum=WGS84 +no_defs','+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',[lon,lat]);
    const q=new URLSearchParams({confmKey:c.env.JUSO_MAP_API_KEY,searchType:'1',pointX:String(x),pointY:String(y),skinType:'2'});
    body=`<div id="mapWrap" class="mapWrap" style="width:100%;height:100%"></div><script src="${escapeHtml('https://business.juso.go.kr/juso_support_center/js/addrlink/map/jusoro_map_api.min.js?'+q)}"></script>`;
  }
  c.header('Content-Security-Policy',"sandbox allow-scripts; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");c.header('Referrer-Policy','strict-origin');
  return c.html(`<!doctype html><html lang="ko" style="height:100%"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>공식 주소 지도</title></head><body style="height:100%;margin:0">${body}</body></html>`,status);
});
