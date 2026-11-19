// Track captured pointers on the map only. Switching from two fingers to one
// starts the remaining drag at its current position.
export function bindTerrainGestures(element,enabled,rotate,zoom){
 const controller=new AbortController(),points=new Map(),options={signal:controller.signal};
 const separation=()=>{const [a,b]=points.values();return Math.hypot(a.x-b.x,a.y-b.y);};
 element.addEventListener('pointerdown',e=>{
  if(!enabled()||e.button!==0||points.size>=2)return;
  points.set(e.pointerId,{x:e.clientX,y:e.clientY});element.setPointerCapture(e.pointerId);
 },options);
 element.addEventListener('pointermove',e=>{
  const old=points.get(e.pointerId);if(!old||!enabled())return;
  const before=points.size===2?separation():0;
  points.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(points.size===1)rotate(e.clientX-old.x,e.clientY-old.y);
  else if(before>1&&separation()>1)zoom(before/separation());
 },options);
 for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,e=>points.delete(e.pointerId),options);
 element.addEventListener('wheel',e=>{
  if(!enabled()||e.ctrlKey&&e.deltaY===0)return;
  e.preventDefault();zoom(Math.exp(Math.max(-1,Math.min(1,e.deltaY*(e.deltaMode===1?.04:.002)))));
 },{...options,passive:false});
 return ()=>controller.abort();
}
