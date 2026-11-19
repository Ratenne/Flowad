// Bounded, user-initiated readiness checks; one road verification follows.
function pause(ms,signal){return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(signal.reason);return;}
 const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason);};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
 signal?.addEventListener('abort',cancel,{once:true});
});}
const recent=new WeakMap();
export async function waitForRoadService({signal,onWaiting=()=>{},fetcher=fetch,wait=pause}){
 signal?.throwIfAborted();
 if((recent.get(fetcher)??0)>Date.now())return;
 for(let attempt=0;attempt<4;attempt++){
  signal?.throwIfAborted();
  const response=await fetcher('./api/navigation/readiness',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal,cache:'no-store'}),data=await response.json();
  if(response.ok&&data.ready===true){recent.set(fetcher,Date.now()+30000);return;}
  if(response.status!==202){const error=Error(data.error||'PROVIDER_UNAVAILABLE');error.retryAfterSeconds=Number(response.headers.get('Retry-After'))||0;throw error;}
  onWaiting();
  if(attempt===3)break;
  await wait(Math.min(20,Math.max(1,data.retryAfterSeconds??20))*1000,signal);
 }
 throw Error('ROAD_PROVIDER_WARMING');
}
