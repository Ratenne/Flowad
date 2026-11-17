// Local UI QA only. Synthetic straight segments MUST NOT be used as real routing.
import {createServer} from 'node:http';
createServer((request,response)=>{
 try{
  const url=new URL(request.url,'http://127.0.0.1'),coordinates=url.pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number));
  const meters=(a,b)=>Math.hypot((a[0]-b[0])*88000,(a[1]-b[1])*111000)*1.3;
  const data=url.pathname.includes('/table/')?{code:'Ok',sources:coordinates.map(location=>({location,distance:0})),durations:coordinates.map(a=>coordinates.map(b=>meters(a,b)/14)),distances:coordinates.map(a=>coordinates.map(b=>meters(a,b)))}:
   {code:'Ok',waypoints:coordinates.map(location=>({location,distance:0})),routes:[{legs:coordinates.slice(1).map((b,i)=>({distance:meters(coordinates[i],b),duration:meters(coordinates[i],b)/14,steps:[{geometry:{coordinates:[coordinates[i],b]}}]}))}]};
  response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(data));
 }catch{response.writeHead(400);response.end();}
}).listen(9191,'127.0.0.1',()=>console.log('LOCAL SYNTHETIC ROAD MOCK ONLY :9191'));
