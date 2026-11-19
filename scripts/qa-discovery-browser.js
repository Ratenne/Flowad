async (page) => {
 const root='C:/Users/user/Documents/ChatGPT/flowad/dist/';
 const courses=Array.from({length:3},(_,i)=>{
  const stops=Array.from({length:3},(_,j)=>({id:'test-'+i+'-'+j,name:['테스트 숲길','테스트 해안','테스트 전망'][i]+' '+(j+1),latitude:37.55+i*.03+j*.012,longitude:127.10+i*.03+j*.015,accessStatus:'POSSIBLE_ACCESS'}));
  const points=[{type:'ORIGIN',name:'테스트 출발지',latitude:37.5665,longitude:126.978},...stops.map(p=>({...p,type:'SCENIC_WAYPOINT'})),{type:'RETURN',name:'복귀',latitude:37.5665,longitude:126.978}];
  return {id:'dyn-browser-'+i,name:['숲으로 돌아가는 길','바람을 만나는 길','전망을 잇는 길'][i],description:'격리된 브라우저 테스트 코스',scenery:['forest','coast','open'][i],region:'테스트 지역',latitude:stops[0].latitude,longitude:stops[0].longitude,score:80+i,estimatedRoundTripKm:70+i*10,estimatedMinutes:120+i*10,stopMinutes:30,waypoints:stops,navigationTicket:'MOCK_ESTIMATED_'+i,route:{status:'ESTIMATED_NOT_ROAD_ROUTED',geometryStatus:'NOT_AVAILABLE',terrainStatus:'UNAVAILABLE',points,legs:points.slice(1).map((_,j)=>({fromOrder:j,toOrder:j+1,distanceKm:20,durationSeconds:1200,geometry:null})),distanceKm:80,drivingSeconds:4800,stopSeconds:1800,totalSeconds:6600,generatedAt:'2026-11-19T00:00:00Z',warnings:[]}};
 });
 const report=[];
 for(const scenario of [{name:'pc',width:1280,height:800},{name:'mobile-no-webgl',width:390,height:844,noWebgl:true},{name:'android-webview-simulation',width:412,height:915,android:true},{name:'native-missing-dem',width:1024,height:600,native:true,missingDem:true}]){
  const tab=await page.context().newPage(),requests=[],errors=[],held=[];let mode='ok',connected=false,verifyFail=false,demRequests=0;
  await tab.setViewportSize({width:scenario.width,height:scenario.height});
  await tab.addInitScript(({native,noWebgl,android})=>{
   if(android)Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (Linux; Android 14; TestDevice; wv) AppleWebKit/537.36 Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36'});
   try{localStorage.removeItem('flowad-integration');}catch{}
   window.__geoCalls=0;window.__native=[];
   Object.defineProperty(navigator,'geolocation',{value:{watchPosition(success){window.__geoCalls++;setTimeout(()=>success({coords:{latitude:37.5665,longitude:126.978,accuracy:15},timestamp:Date.now()}),0);return 1;},clearWatch(){}}});
   if(native)window.FlowadNative={postMessage(message){window.__native.push(JSON.parse(message));}};
   if(noWebgl){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl'||type==='webgl2'||type==='experimental-webgl')return null;return original.call(this,type,...args);};}
  },scenario);
  tab.on('pageerror',error=>errors.push(error.message));
  await tab.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='api.open-meteo.com'){const size=u.searchParams.get('latitude').split(',').length,weather=()=>({hourly:{time:[Math.floor(Date.now()/1000)],temperature_2m:[20],weather_code:[0],wind_speed_10m:[2]}});return route.fulfill({json:size===1?weather():Array.from({length:size},weather)});}
   if(u.hostname!=='flowad.test')return route.abort();
   if(u.pathname.endsWith('/api/recommendations')){requests.push('recommendations');if(mode==='hold')return new Promise(resolve=>held.push({route,resolve}));return route.fulfill({json:{courses,diagnostics:{tableCalls:0,routeCalls:0}}});}
   if(u.pathname.endsWith('/api/location/address'))return route.fulfill({json:{label:'테스트로 1',type:'ROAD_ADDRESS',source:'JUSO_MAP'}});
   if(u.pathname.endsWith('/api/tesla/status')){requests.push('tesla-status');return route.fulfill({json:{connection:connected?'CONNECTED':'NOT_CONNECTED',csrf:'MOCK_CSRF',secure:true,locationReady:connected}});}
   if(u.pathname.endsWith('/api/navigation/verify')){requests.push('verify');if(verifyFail)return route.fulfill({status:503,json:{error:'PROVIDER_UNAVAILABLE',roadVerified:false}});return route.fulfill({json:{roadVerified:true,withinAvailableMinutes:true,batteryStatus:'NOT_APPLICABLE',navigationTicket:'MOCK_VERIFIED_ONLY',route:{...courses[0].route,status:'ROAD_ROUTED',provider:'MOCK_ROADS',geometryStatus:'NOT_REQUESTED_FREE_PLAN'}}});}
   if(u.pathname.includes('/api/'))throw Error('Unexpected API request: '+u.pathname);
   if(u.pathname.includes('/terrain/tiles/manifest.json')){demRequests++;if(scenario.missingDem)return route.fulfill({status:404,body:''});}
   const relative=decodeURIComponent(u.pathname.replace(/^\/flowad\/?/,''))||'index.html';
   if(relative.includes('..')||!/^[\w/.-]+$/.test(relative))return route.abort();
   return route.fulfill({path:root+relative});
  });
  try{
   await tab.goto('https://flowad.test/flowad/');
   if(requests.includes('tesla-status'))throw Error('Tesla session queried for an anonymous default visitor');
   const visiblePrimary=await tab.locator('.button-primary:visible,.main-action:visible').count();if(visiblePrimary!==1)throw Error('Duplicate primary action: '+visiblePrimary);
   if(scenario.native){await tab.locator('#demoBtn').click();await tab.locator('#cityChoices').getByRole('button',{name:'서울',exact:true}).click();}else await tab.locator('#heroLocate').click();
   await tab.locator('[data-preview]').first().waitFor();await tab.waitForFunction(()=>document.querySelector('#landscape').dataset.terrainCourse==='dyn-browser-0');
   const locationText=await tab.locator('#mainLocationStatus').textContent();if(/위도|경도|37\.5665|126\.978|BROWSER|GPS/.test(locationText))throw Error('Technical location leaked to basic UI');
   const cardCount=await tab.locator('[data-preview]').count(),geoBefore=await tab.evaluate(()=>window.__geoCalls);
   mode='hold';await tab.locator('#refreshRecommendations').click();await tab.waitForFunction(()=>document.querySelector('#refreshRecommendations').disabled);
   if(await tab.locator('[data-preview]').count()!==cardCount)throw Error('Refresh discarded existing cards');
   if(await tab.evaluate(()=>window.__geoCalls)!==geoBefore)throw Error('Course refresh restarted GPS');
   const deadline=Date.now()+10000;while(!held.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!held.length)throw Error('Refresh request did not start');
   mode='ok';await held[0].route.fulfill({status:503,json:{error:'SERVICE_UNAVAILABLE'}});held[0].resolve();await tab.waitForFunction(()=>!document.querySelector('#refreshRecommendations').disabled);
   if(await tab.locator('[data-preview]').count()!==cardCount)throw Error('Failure discarded previous courses');
   for(const input of await tab.locator('[data-compare]').all())await input.check();
   await tab.locator('#compareRoutes').click();await tab.locator('#visualComparison').waitFor();
   await tab.locator('[data-compare-preview="dyn-browser-1"]').click();await tab.locator('[data-compare-preview="dyn-browser-2"]').click();await tab.locator('[data-compare-preview="dyn-browser-0"]').click();
   await tab.waitForFunction(()=>document.querySelector('#landscape').dataset.terrainCourse==='dyn-browser-0');
   if(scenario.noWebgl||scenario.missingDem){if(!await tab.locator('#courseFallback').isVisible())throw Error('2D fallback not visible');}
   if(scenario.name==='pc'){
    await tab.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await tab.screenshot({path:'C:/Users/user/Documents/ChatGPT/flowad/artifacts/ux-pc-before-context.png',fullPage:true});
    await tab.evaluate(()=>{window.__lost=document.querySelector('#terrainCanvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__lost.loseContext();});await tab.locator('#courseFallback').waitFor();
    await tab.evaluate(()=>window.__lost.restoreContext());await tab.waitForFunction(()=>document.querySelector('#courseFallback').hidden);
    await tab.locator('#previewMode').click();if(!await tab.locator('#courseFallback').isVisible())throw Error('Full stop view did not open');await tab.locator('#previewMode').click();
   }
   await tab.locator('#chooseComparedCourse').click();await tab.locator('#selectedDetail').click();
   if(!scenario.native){
    if(await tab.locator('[data-tesla-preview]').count())throw Error('Tesla-specific UI shown before selection');
    await tab.locator('[data-detail-integration]').selectOption('pleos');if(await tab.locator('[data-native-route]').count())throw Error('Unsupported native bridge offered');
    await tab.locator('[data-detail-integration]').selectOption('other');await tab.locator('[data-road-verify]').click();await tab.locator('#roadVerificationResult').getByText(/도로선 자료는 없어/).waitFor();
    await tab.locator('[data-close-detail]').click();await tab.locator('#settingsBtn').click();await tab.locator('[data-setting-tab="vehicle"]').click();
    if(await tab.locator('#teslaIntegrationPanel').isVisible())throw Error('Tesla login shown to another vehicle');
    connected=true;await tab.locator('#vehicleIntegration').selectOption('tesla');await tab.waitForFunction(()=>document.querySelector('#teslaConnect').hidden);
    connected=false;await tab.locator('#vehicleIntegration').selectOption('none');await tab.locator('#vehicleIntegration').selectOption('tesla');await tab.locator('#teslaConnect').waitFor();
    await tab.locator('#vehicleIntegration').selectOption('none');await tab.locator('#settingsDialog [data-close]').click();
   }else{
    await tab.locator('[data-detail-integration]').selectOption('pleos');
    await tab.locator('[data-native-route]').click();await tab.waitForFunction(()=>window.__native.length===1);if(await tab.evaluate(()=>window.__native[0].ticket)!=='MOCK_VERIFIED_ONLY')throw Error('Estimated ticket sent to native bridge');
    verifyFail=true;await tab.locator('[data-native-route]').click();if(await tab.evaluate(()=>window.__native.length)!==1)throw Error('Failed road verification sent to native bridge');
    await tab.locator('[data-close-detail]').click();
   }
   await tab.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const view=await tab.locator('#landscape').evaluate(el=>({...el.dataset}));
   const layout=await tab.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));if(layout.content>layout.viewport+1)throw Error('Horizontal layout overflow: '+JSON.stringify(layout));
   if(errors.length)throw Error('Browser runtime error: '+errors.join(';'));
   await tab.screenshot({path:'C:/Users/user/Documents/ChatGPT/flowad/artifacts/ux-'+scenario.name+'.png',fullPage:true});
   const canvas=await tab.locator('#terrainCanvas').evaluate(el=>({width:el.width,height:el.height,clientWidth:el.clientWidth,clientHeight:el.clientHeight,display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,opacity:getComputedStyle(el).opacity}));
   report.push({scenario:scenario.name,cardCount,retainedAfterFailure:true,geoReused:true,comparisonWorks:true,preview:view.terrainSource,renderer:view.terrainRenderer,demRequests,layout,canvas,realVehicleCommands:0,errors});
  }finally{for(const pending of held){pending.resolve();}await tab.close();}
 }
 return {mode:'LOCAL_FRONTEND_REAL_DEM_MOCK_API_AND_NATIVE_BRIDGE',report};
}
