async (page) => {
 const root='C:/Users/user/Documents/ChatGPT/flowad/',reports=[];
 for(const mode of ['before','after','poi','partial']){
  const tab=await page.context().newPage();await tab.setViewportSize({width:1100,height:720});
  const errors=[];tab.on('pageerror',e=>errors.push(e.message));
  await tab.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.hostname!=='terrain.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><style>body{margin:0;background:#1c291f;color:#e6e8d9;font:14px sans-serif}#host{position:relative;width:1100px;height:650px}canvas{width:100%;height:100%}#labels{position:absolute;inset:0;pointer-events:none}.scene-label{position:absolute;transform:translate(-50%,-100%);padding:6px;background:#293624;border:1px solid #687b4f;border-radius:5px;white-space:nowrap}.scene-label small{color:#edac78;margin-right:6px}.real-terrain-loading{position:absolute;top:0}button{background:#293624;color:#ece6cf;padding:12px;border:1px solid #66764d}</style><h3>실제 고도 3D · ${mode}</h3><div id="host"><canvas id="canvas"></canvas><div id="labels"></div></div><button id="tourBtn"><svg><use></use></svg><span class="tour-label">미리 달리기</span></button><script type="module">import {createTerrainView} from '/terrain-view.js';import {dynamicTerrain} from '/dynamic-terrain.js';const data=await(await fetch('/terrain/yangpyeong.json')).json();const anchors=data.road.anchors;const course={id:'dyn-quality',name:'강과 숲 사이',lat:anchors[0].coordinate[1],route:{points:anchors.map((a,i)=>({type:'SCENIC_WAYPOINT',name:a.label,longitude:a.coordinate[0],latitude:a.coordinate[1]})),legs:[],status:'ESTIMATED_NOT_ROAD_ROUTED'}};let model=data;if('${mode}'==='poi')model=await dynamicTerrain(course);if('${mode}'==='partial'){model={...data,elevationStatus:'PARTIAL',grid:{...data.grid,validity:data.grid.elevations.map((_,i)=>i%data.grid.width<data.grid.width*.65)}};}window.view=createTerrainView({canvas:document.querySelector('#canvas'),host:document.querySelector('#host'),labelLayer:document.querySelector('#labels'),fetcher:async()=>model,onStatus:s=>{window.result={state:s.state,renderer:s.renderer,kind:s.model?.data.previewKind,min:s.model?.min,max:s.model?.max};}});await view.setRoute({id:model.courseId});</script>`});
   const path=u.pathname.slice(1);if(path.includes('..'))return route.abort();
   if(mode==='before'&&['terrain-view.js','terrain-model.js','dynamic-terrain.js'].includes(path))return route.fulfill({path:root+'artifacts/ux-baseline/'+path});
   return route.fulfill({path:root+'dist/'+path});
  });
  try{
   await tab.goto('https://terrain.test/');await tab.waitForFunction(()=>window.result?.state==='ready');
   await tab.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const result=await tab.evaluate(()=>window.result);if(result.renderer!=='webgl'||errors.length)throw Error(JSON.stringify({result,errors}));
   await tab.screenshot({path:root+'artifacts/terrain-quality-'+mode+'.png'});
   if(mode==='poi'){await tab.evaluate(()=>view.toggleTour());await tab.waitForFunction(()=>document.querySelector('#tourBtn').classList.contains('active'));await tab.evaluate(()=>view.pause());}
   reports.push({mode,...result,errors});
  }finally{await tab.close();}
 }
 return reports;
}
