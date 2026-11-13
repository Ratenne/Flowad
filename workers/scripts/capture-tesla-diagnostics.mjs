import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail','flowad-api-stage2','--config','wrangler.stage2.jsonc','--format','json'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const records=[];let buffer='',start=-1,depth=0,string=false,escape=false;
child.stdout.on('data',chunk=>{for(const ch of chunk.toString()){
  buffer+=ch;if(start<0){if(ch==='{'){start=buffer.length-1;depth=1;}else if(buffer.length>10000)buffer='';continue;}
  if(string){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')string=false;continue;}
  if(ch==='"'){string=true;continue;}if(ch==='{')depth++;if(ch==='}')depth--;
  if(depth===0){try{
    const item=JSON.parse(buffer.slice(start));
    for(const log of item.logs??[])for(const message of log.message??[]){
      if(typeof message!=='string')continue;let data;try{data=JSON.parse(message);}catch{continue;}
      if(data.event==='tesla_upstream_http')records.push({at:new Date(item.eventTimestamp).toISOString(),operation:data.operation,upstreamHttpStatus:data.httpStatus,workerHttpStatus:item.event?.response?.status,cpuTimeMs:item.cpuTime,wallTimeMs:item.wallTime,outcome:item.outcome});
    }
    awaitWrite();
  }catch{/* Never print raw events, URLs, headers or exception messages. */}buffer='';start=-1;}
}});
function awaitWrite(){void writeFile('.wrangler/stage2/tesla-diagnostics.json',JSON.stringify({observedAt:new Date().toISOString(),records},null,2));}
child.stderr.on('data',()=>{});
setTimeout(()=>{child.kill();awaitWrite();console.log(JSON.stringify({records},null,2));},60000);
