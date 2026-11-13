import { Hono } from 'hono';
import proj4 from 'proj4';
import type { Bindings } from './types';
import { coordinate } from './utils';
type XY=[number,number];
type Polygon=XY[][];
// The existing public index contains 2D WKB Point, Polygon and MultiPolygon.
// Decode with DataView so no Buffer, Java/JTS or filesystem is needed at runtime.
export function geometry(raw: ArrayBuffer): Polygon[] {
  const v=new DataView(raw);let at=0,vertices=0;
  function shape(depth=0):Polygon[]{
    if(depth>4||at+5>v.byteLength)throw new Error('Invalid WKB');
    const little=v.getUint8(at++)===1,type=v.getUint32(at,little);at+=4;
    const u32=()=>{const n=v.getUint32(at,little);at+=4;if(n>50000)throw new Error('Geometry limit');return n;};
    const xy=():XY=>{if(++vertices>50000)throw new Error('Geometry limit');const x=v.getFloat64(at,little),y=v.getFloat64(at+8,little);at+=16;if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Invalid WKB');return[x,y];};
    if(type===1)return[[[xy()]]];
    if(type===3){const count=u32(),rings:Polygon=[];for(let i=0;i<count;i++){const n=u32(),ring:XY[]=[];for(let j=0;j<n;j++)ring.push(xy());rings.push(ring);}return[rings];}
    if(type===6){const count=u32(),polys:Polygon[]=[];for(let i=0;i<count;i++)polys.push(...shape(depth+1));return polys;}
    throw new Error('Unsupported WKB');
  }
  const result=shape();if(at!==v.byteLength)throw new Error('Invalid WKB');return result;
}
function segment(p:XY,a:XY,b:XY,scale:number){
  const ax=(a[0]-p[0])*scale,ay=(a[1]-p[1])*111320,bx=(b[0]-p[0])*scale,by=(b[1]-p[1])*111320;
  const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(ax+t*dx,ay+t*dy);
}
function inside(p:XY,ring:XY[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export function measure(polygons:Polygon[],p:XY){
  const scale=111320*Math.max(.01,Math.cos(p[1]*Math.PI/180));let covers=false,nearest=Infinity,area=0;
  for(const rings of polygons){
    let boundary=false;
    rings.forEach((ring,r)=>{let sum=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],d=segment(p,a,b,scale);nearest=Math.min(nearest,d);if(d<1e-7)boundary=true;sum+=a[0]*b[1]-b[0]*a[1];}area+=(r===0?1:-1)*Math.abs(sum/2);});
    if(boundary||(rings[0]&&inside(p,rings[0])&&!rings.slice(1).some(r=>inside(p,r))))covers=true;
  }
  return {covers,nearest,area};
}
const escapeHtml=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
export const locations=new Hono<Bindings>();
locations.post('/address',async c=>{
  const raw:unknown=await c.req.json().catch(()=>null),parsed=coordinate.safeParse(raw);
  if(!parsed.success)return c.body(null,400);
  if(!c.env.ADDRESS_DB)return c.body(null,503);
  const {latitude:lat,longitude:lon}=parsed.data,scale=111320*Math.max(.01,Math.cos(lat*Math.PI/180)),dx=26/scale,dy=26/111320;
  try{
    const rows=await c.env.ADDRESS_DB.prepare('SELECT p.name,p.address,p.shape FROM bounds b CROSS JOIN place p ON p.id=b.id WHERE b.west<=? AND b.east>=? AND b.south<=? AND b.north>=? LIMIT 101').bind(lon+dx,lon-dx,lat+dy,lat-dy).all<{name:string;address:string;shape:number[]|ArrayBuffer}>();
    // Dense/unbounded source data must not produce a misleading best match.
    if(rows.results.length>100)return c.body(null,503);
    const candidates=[];
    for(const row of rows.results){
      const raw=row.shape instanceof ArrayBuffer?row.shape:Uint8Array.from(row.shape).buffer;
      const m=measure(geometry(raw),[lon,lat]);
      if(m.covers&&(row.name||row.address))candidates.push({label:row.name||row.address,type:row.name?'BUILDING':'ROAD_ADDRESS',priority:row.name?0:1,distance:0,area:m.area});
      else if(row.address&&m.nearest<=25)candidates.push({label:row.address,type:'NEARBY_ADDRESS',priority:2,distance:m.nearest,area:m.area});
    }
    candidates.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.area-b.area);
    return candidates.length?c.json({label:candidates[0].label,type:candidates[0].type}):c.body(null,204);
  }catch{return c.body(null,503);}
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
