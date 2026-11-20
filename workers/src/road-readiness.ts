import {Failure,httpJson} from './utils';
function pause(ms:number,signal?:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
  signal?.addEventListener('abort',cancel,{once:true});
 });
}
// Render Free can take ~one minute to resume. One API operation may wait for
// readiness, instead of repeatedly failing in the browser and starting new jobs.
// Retry only transient startup failures. A 429 always ends this operation.
export async function readyTable(url:string,signal:AbortSignal|undefined,timeoutMs:number,retry:boolean,
 deps:{request?:typeof httpJson;wait?:typeof pause}={}){
 const request=deps.request??httpJson,wait=deps.wait??pause;
 const defer=(ms:number,attempt:number,status:number|null)=>{
  console.warn(JSON.stringify({event:'road_provider_wait',attempt:attempt+1,httpStatus:status,waitMs:ms}));
  return wait(ms,signal);
 };
 for(let attempt=0;;attempt++){
  if(signal?.aborted)throw signal.reason;
  let response;
  try{response=await request(url,{signal},timeoutMs);}
  catch(error){
   if(signal?.aborted)throw signal.reason;
   if(!retry||attempt===2||!(error instanceof Failure)||!['UPSTREAM_TIMEOUT','SERVICE_UNAVAILABLE'].includes(error.code))throw error;
   await defer(20000,attempt,null);continue;
  }
  if(!retry||response.challenged||![502,503,504].includes(response.status)||attempt===2)return response;
  const seconds=response.retryAfterSeconds??20;
  // A longer provider allowance must not be retried early or held indefinitely.
  if(seconds>30)return response;
  await defer(Math.max(1,seconds)*1000,attempt,response.status);
 }
}
