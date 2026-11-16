import {createServer} from 'node:http';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {BODY_LIMIT,validate,execute} from './adapter.mjs';
const bootId=randomUUID();
export function server({token,base,fetcher=fetch,timeoutMs=8000}={}){
 if(typeof token!=='string'||token.length<32)throw Error('BATCH_TOKEN must be a strong credential of at least32 characters');
 const u=new URL(base);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol==='http:'&&!['127.0.0.1','localhost'].includes(u.hostname)))throw Error('Invalid fixed OSRM base');
 const expected=Buffer.from('Bearer '+token);let active=false;
 return createServer(async(req,res)=>{
  const send=(status,data)=>{const text=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(text);};
  if(req.method==='GET'&&req.url==='/health'){send(200,{status:'ok',experimental:true});return;}
  if(req.url!=='/v1/routes/batch'){send(404,{error:'NOT_FOUND'});return;}
  const got=Buffer.from(req.headers.authorization??'');
  if(got.length!==expected.length||!timingSafeEqual(got,expected)){send(403,{error:'FORBIDDEN'});return;}
  if(req.method!=='POST'){send(405,{error:'METHOD_NOT_ALLOWED'});return;}
  if(req.headers['content-type']?.split(';')[0]!=='application/json'){send(415,{error:'UNSUPPORTED_MEDIA_TYPE'});return;}
  if(active){send(503,{error:'BATCH_BUSY'});return;}
  active=true;
  try{
   const start=performance.now(),cpu=process.cpuUsage(),rssBefore=process.memoryUsage().rss,uptimeSeconds=process.uptime();
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>BODY_LIMIT){send(413,{error:'REQUEST_TOO_LARGE'});return;}chunks.push(chunk);}
   let routes;try{routes=validate(JSON.parse(Buffer.concat(chunks,size).toString('utf8')));}catch{send(400,{error:'INVALID_BATCH'});return;}
   const data=await execute(routes,{base:u.href.replace(/\/$/,''),fetcher,timeoutMs});
   const used=process.cpuUsage(cpu);
   // On a separate service these describe the adapter, NOT remote OSRM.
   let containerMemoryBytes=null;try{const n=Number((await readFile('/sys/fs/cgroup/memory.current','utf8')).trim());if(Number.isFinite(n))containerMemoryBytes=n;}catch{}
   data.metrics={...data.metrics,adapterWallMs:Math.round((performance.now()-start)*100)/100,adapterCpuUserMicros:used.user,adapterCpuSystemMicros:used.system,rssBeforeBytes:rssBefore,rssAfterBytes:process.memoryUsage().rss,processPeakRssBytes:process.resourceUsage().maxRSS*1024,containerMemoryBytes,uptimeSeconds,bootId};
   send(200,data);
  }catch{if(!res.headersSent)send(503,{error:'SERVICE_UNAVAILABLE'});}
  finally{active=false;}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=server({token:process.env.BATCH_TOKEN,base:process.env.OSRM_BASE_URL??'http://127.0.0.1:5000'});
 app.requestTimeout=90000;app.headersTimeout=10000;
 app.listen(Number(process.env.PORT??10000),'0.0.0.0',()=>console.log('Experimental batch adapter ready; request logging disabled'));
}
