import proj4 from 'proj4';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

// Coordinate search used by the official Juso map SDK (checked 2026-11-16).
// This is the map service's JSONP/XML protocol, not addrLinkApi's keyword search.
export const jusoAddressUrl='https://business.juso.go.kr/addrlink/addrMapData.do';
const limit=262144;
export class JusoFailure extends Error {}
export function jusoForm(key:string,latitude:number,longitude:number){
  const [x,y]=proj4('+proj=longlat +datum=WGS84 +no_defs','+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',[longitude,latitude]);
  return new URLSearchParams({confmKey:key,searchType:'1',pointX:String(x),pointY:String(y),encryptYn:'Y',encodingType:'UTF-8',resultType:'2',currentPage:'1',countPerPage:'5',callback:'flowadJuso'});
}
export function parseJusoAddress(raw:string){
  if(raw.length>limit)throw new JusoFailure('JUSO_INVALID_RESPONSE');
  // The official service returns a single-quoted JS string, not JSON. Decode
  // only that string; never evaluate JSONP or execute provider content.
  const wrapper=/^\s*flowadJuso\(\{'returnXml':'([\s\S]*)'\}\)\s*;?\s*$/.exec(raw);
  if(!wrapper)throw new JusoFailure('JUSO_INVALID_RESPONSE');
  const escapes:Record<string,string>={"'":"'",'"':'"','\\':'\\',n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','/':'/'};
  const xml=wrapper[1].replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|[\s\S])/g,(_,escape:string)=>{
    if(escape[0]==='u'||escape[0]==='x')return String.fromCharCode(parseInt(escape.slice(1),16));
    if(Object.hasOwn(escapes,escape))return escapes[escape];
    throw new JusoFailure('JUSO_INVALID_RESPONSE');
  });
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new JusoFailure('JUSO_INVALID_RESPONSE');
  const data=new XMLParser({parseTagValue:false,ignoreAttributes:true,isArray:name=>name==='juso'}).parse(xml);
  const common=data?.results?.common;
  if(!common||typeof common.errorCode!=='string')throw new JusoFailure('JUSO_INVALID_RESPONSE');
  if(common.errorCode!=='0')throw new JusoFailure(common.errorCode==='E0001'?'JUSO_KEY_REJECTED':'JUSO_REQUEST_REJECTED');
  if(!/^\d+$/.test(common.totalCount))throw new JusoFailure('JUSO_INVALID_RESPONSE');
  if(Number(common.totalCount)===0)return null;
  const first=data.results.juso?.[0];
  const label=first?.roadAddrPart1||first?.roadAddr;
  if(typeof label!=='string'||!label.trim()||label.length>500)throw new JusoFailure('JUSO_INVALID_RESPONSE');
  // A coordinate search is an address match, not proof of building occupancy.
  return {label:label.trim(),type:'ROAD_ADDRESS',source:'JUSO_MAP'};
}
export async function lookupJusoAddress(key:string,latitude:number,longitude:number){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  try{
    const response=await fetch(jusoAddressUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:jusoForm(key,latitude,longitude),redirect:'manual',signal:controller.signal});
    if(!response.ok)throw new JusoFailure('JUSO_UNAVAILABLE');
    if(Number(response.headers.get('Content-Length'))>limit)throw new JusoFailure('JUSO_INVALID_RESPONSE');
    const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
    if(!reader)throw new JusoFailure('JUSO_INVALID_RESPONSE');
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new JusoFailure('JUSO_INVALID_RESPONSE');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return parseJusoAddress(new TextDecoder().decode(bytes));
  }catch(e){if(e instanceof JusoFailure)throw e;throw new JusoFailure(controller.signal.aborted?'JUSO_TIMEOUT':'JUSO_UNAVAILABLE');}
  finally{clearTimeout(timer);}
}
