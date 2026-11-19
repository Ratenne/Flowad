// Load the public map SDK only when the user opens the location map.
export function createNaverMapView({container,status,confirmButton,fetcher=globalThis.fetch,win=window,doc=document,timeoutMs=10000}){
 let sdkPromise=null,map=null,marker=null,revision=0,loadRevision=0,controller=null,authHandler=null,previousAuth=null;
 let selection=null,eventApi=null;const mapListeners=[];
 function select(position){
  const lat=typeof position?.lat==='function'?position.lat():position?.lat,lng=typeof position?.lng==='function'?position.lng():position?.lng;
  selection=Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=32&&lat<=40&&lng>=124&&lng<=132?{lat,lng}:null;
  if(confirmButton)confirmButton.disabled=!selection;
  status.textContent=selection?'마커를 끌거나 지도를 눌러 위치를 고른 뒤 ‘이 위치에서 출발’을 누르세요.':'대한민국 안의 출발 위치를 선택해 주세요.';
 }
 const authResourceError=event=>{
  try{const url=new URL(event.target?.src);if(url.hostname==='oapi.map.naver.com'&&url.pathname==='/v3/auth')authHandler?.();}catch{/* Ignore unrelated application/resource errors. */}
 };
 function load(keyId,keyParameter){
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
   const script=doc.createElement('script'),callback='flowadNaverMapReady'+(++loadRevision),previous=win.navermap_authFailure;let settled=false,readyTimer=null;
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(readyTimer);delete win[callback];if(previous===undefined)delete win.navermap_authFailure;else win.navermap_authFailure=previous;
    if(error){script.remove();reject(Error(error));}else resolve(win.naver.maps);};
   const timer=setTimeout(()=>finish('NAVER_MAP_TIMEOUT'),timeoutMs);
   // The bootstrap callback can run just before Map is exported by the SDK.
   // Wait within the same deadline; do not issue a second SDK request.
   const ready=()=>{if(settled)return;if(win.naver?.maps?.Map)finish();else readyTimer=setTimeout(ready,25);};
   win[callback]=ready;
   win.navermap_authFailure=()=>finish('NAVER_MAP_AUTH_FAILED');
   script.onerror=()=>finish('NAVER_MAP_UNAVAILABLE');
   script.src='https://oapi.map.naver.com/openapi/v3/maps.js?'+new URLSearchParams({[keyParameter]:keyId,callback});
   script.async=true;script.referrerPolicy='strict-origin';doc.head.append(script);
  }).catch(error=>{sdkPromise=null;throw error;});
  return sdkPromise;
 }
 function clear(){
  selection=null;if(confirmButton)confirmButton.disabled=true;
  for(const listener of mapListeners)eventApi.removeListener(listener);mapListeners.length=0;eventApi=null;
  win.removeEventListener('error',authResourceError,true);
  if(authHandler&&win.navermap_authFailure===authHandler){if(previousAuth===undefined)delete win.navermap_authFailure;else win.navermap_authFailure=previousAuth;}
  authHandler=null;previousAuth=null;marker?.setMap(null);marker=null;map?.destroy();map=null;container.replaceChildren();
 }
 return {
  async show(location){
   const current=++revision;controller?.abort();const requestController=new AbortController();controller=requestController;clear();status.textContent='네이버 지도를 불러오는 중입니다.';
   const timer=setTimeout(()=>requestController.abort(),timeoutMs);
   try{
    if(!location||!Number.isFinite(location.lat)||!Number.isFinite(location.lng)||Math.abs(location.lat)>90||Math.abs(location.lng)>180)throw Error('LOCATION_REQUIRED');
    const response=await fetcher('./api/location/map-config',{signal:requestController.signal,cache:'no-store'}),config=await response.json();
    clearTimeout(timer);
    if(current!==revision)return;
    if(!response.ok)throw Error(config.error||'NAVER_MAP_UNAVAILABLE');
    if(config.provider!=='NAVER'||typeof config.keyId!=='string'||!/^[A-Za-z0-9_-]{4,200}$/.test(config.keyId))throw Error('NAVER_MAP_UNAVAILABLE');
    const keyParameter=config.keyParameter??'ncpKeyId';
    if(!['ncpKeyId','ncpClientId'].includes(keyParameter))throw Error('NAVER_MAP_UNAVAILABLE');
    const maps=await load(config.keyId,keyParameter);if(current!==revision)return;
    // Authentication may complete after the SDK bootstrap and map creation.
    previousAuth=win.navermap_authFailure;
    authHandler=()=>{if(current!==revision)return;clear();sdkPromise=null;status.textContent='네이버 지도 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.';};
    win.navermap_authFailure=authHandler;
    win.addEventListener('error',authResourceError,true);
    const center=new maps.LatLng(location.lat,location.lng);
    map=new maps.Map(container,{center,zoom:15,zoomControl:true});
    marker=new maps.Marker({position:center,map,title:'끌어서 출발 위치 선택',draggable:true});
    eventApi=maps.Event;
    mapListeners.push(eventApi.addListener(marker,'dragstart',()=>{if(current!==revision||!marker)return;selection=null;if(confirmButton)confirmButton.disabled=true;}));
    mapListeners.push(eventApi.addListener(marker,'dragend',()=>{if(current===revision&&marker)select(marker.getPosition());}));
    mapListeners.push(eventApi.addListener(map,'click',event=>{if(current!==revision||!marker)return;const position=event.coord??event.latlng;if(!position)return;marker.setPosition(position);select(position);}));
    select(center);
   }catch(error){if(current!==revision)return;status.textContent=({NAVER_MAP_NOT_CONFIGURED:'네이버 지도가 아직 설정되지 않았습니다.',NAVER_MAP_AUTH_FAILED:'네이버 지도 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.',NAVER_MAP_TIMEOUT:'네이버 지도 응답이 늦습니다. 닫았다가 다시 시도해 주세요.',LOCATION_REQUIRED:'먼저 출발 위치를 확인해 주세요.'})[error.message]||'네이버 지도를 불러오지 못했습니다. 닫았다가 다시 시도해 주세요.';}
   finally{clearTimeout(timer);}
  },
  getSelection(){return selection?{...selection}:null;},
  close(){revision++;controller?.abort();controller=null;clear();status.textContent='';}
 };
}
