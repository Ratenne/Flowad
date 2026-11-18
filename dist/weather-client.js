function failure(code){return Object.assign(new Error(code),{code});}
export function weatherFailureMessage(error){return ({WEATHER_TIMEOUT:'예보 서버 응답 시간 초과',WEATHER_NETWORK:'예보 서버 연결 실패',WEATHER_RATE_LIMIT:'예보 서버 요청 제한',WEATHER_INVALID:'예보 응답 형식 오류',WEATHER_HTTP:'예보 서버 응답 오류'})[error?.code]??'예보 조회 실패';}
// Two bounded attempts only for transport errors/timeouts/5xx. Never retry 429,
// invalid data or a cancelled/manual-location request. No provider/body logging.
export async function requestWeather(url,{signal,fetcher=globalThis.fetch,attemptMs=6000}={}){
 for(let attempt=0;attempt<2;attempt++){
  if(signal?.aborted)throw signal.reason;
  const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(),attemptMs);
  try{
   const response=await fetcher(url,{signal:controller.signal,referrerPolicy:'no-referrer'});
   if(response.status===429){await response.body?.cancel().catch(()=>undefined);throw failure('WEATHER_RATE_LIMIT');}
   if(!response.ok){await response.body?.cancel().catch(()=>undefined);if(response.status>=500&&attempt===0)continue;throw failure('WEATHER_HTTP');}
   try{return await response.json();}catch(error){if(controller.signal.aborted)throw error;throw failure('WEATHER_INVALID');}
  }catch(error){
   if(signal?.aborted)throw signal.reason;
   if(typeof error?.code==='string'&&error.code.startsWith('WEATHER_'))throw error;
   if(attempt===1)throw failure(controller.signal.aborted?'WEATHER_TIMEOUT':'WEATHER_NETWORK');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
}
