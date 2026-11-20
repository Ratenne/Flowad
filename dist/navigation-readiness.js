export async function requestRoadVerification(body,{signal,fetcher=fetch}={}){
 const response=await fetcher('./api/navigation/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,cache:'no-store'});
 const data=await response.json();
 if(response.ok&&data.roadVerified===true)return data;
 const error=Error(data.error||'ROAD_VERIFICATION_REQUIRED');
 error.waypointOrders=data.waypointOrders;
 const retryAfter=Number(response.headers.get('Retry-After'));
 if(Number.isFinite(retryAfter)&&retryAfter>0)error.retryAfterSeconds=retryAfter;
 throw error;
}

export function roadRetryMessage(retryAt,now=Date.now()){
 const seconds=Math.ceil((retryAt-now)/1000);
 return seconds>0?' '+seconds+'초 후 다시 시도할 수 있어요.':'';
}
