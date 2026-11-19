const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function applyVerifiedRoute(course,result){
 if(result.roadVerified!==true||result.route?.status!=='ROAD_ROUTED'||!result.navigationTicket)throw Error('ROAD_VERIFICATION_REQUIRED');
 const minutes=Math.ceil(result.route.totalSeconds/60);
 return {...course,route:result.route,navigationTicket:result.navigationTicket,km:result.route.distanceKm,estimatedRoundTripKm:result.route.distanceKm,estimatedMinutes:minutes,minutes,apiMinutes:minutes,drivingMinutes:Math.ceil(result.route.drivingSeconds/60),stopMinutes:result.route.stopSeconds/60,batteryStatus:result.batteryStatus,distanceTimeStatus:'ROAD_ROUTED',vehicleTransferAllowed:true,dataSource:{...course.dataSource,distanceTime:result.route.provider}};
}
export function arrivalTimes(course,departure){
 let time=departure;
 const stopSeconds=(course.route?.stopSeconds??0)/Math.max(1,course.waypoints?.length??0);
 return (course.route?.points??[]).map((p,i)=>{
  if(i){time+=(course.route.legs?.[i-1]?.durationSeconds??0)*1000;if(['SCENIC_WAYPOINT','DESTINATION'].includes(course.route.points[i-1].type))time+=stopSeconds*1000;}
  return time;
 });
}
export function courseFromApi(item){
 if(!item||typeof item.id!=='string'||!/^[\w-]{1,100}$/.test(item.id)||typeof item.name!=='string'||!finite(item.estimatedRoundTripKm)||!finite(item.estimatedMinutes)||!Array.isArray(item.route?.points))throw Error('INVALID_DYNAMIC_COURSE');
 const points=item.route.points;
 if(points.length<2||points.length>17||points.some(p=>!finite(p.latitude)||!finite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180||typeof p.name!=='string'))throw Error('INVALID_DYNAMIC_POINTS');
 const stops=item.waypoints??[];
 const mood=['forest','coast','open'].includes(item.scenery)?item.scenery:'open';
 const anchor=stops[0]??points[1];
 return {...item,area:item.region??'주변 명소',mood,scene:mood,lat:item.latitude??anchor.latitude,lng:item.longitude??anchor.longitude,
  km:item.estimatedRoundTripKm,minutes:item.estimatedMinutes,apiMinutes:item.estimatedMinutes,apiReasons:item.reasons??[],
  walk:Math.max(0,(item.stopMinutes??0)-stops.length*10),shade:mood==='forest'?.7:.2,exposure:mood==='forest'?.3:.8,altitude:0,ease:.5,novelty:.5,
  intro:item.description??'공개 POI와 실제 도로 연결로 구성한 코스입니다.',tags:[mood==='forest'?'숲':mood==='coast'?'해안':'전망'],
  spots:points.map(p=>[p.name,p.type==='ORIGIN'?'선택한 출발 위치':p.type==='RETURN'?'선택한 복귀 위치':({POSSIBLE_ACCESS:'도로 접근 후보 · 명소 진입과 주차는 미확인',VERIFIED_ACCESS:'기록된 접근 확인 정보 · 현재 통행은 별도 확인',UNVERIFIED_ACCESS:'차량 접근 미확인'})[p.verification]||'현재 명소 진입과 주차는 미확인']),
  waypoints:stops,route:item.route,roundTrip:points.at(-1).type==='RETURN'};
}
export function bookmarkTemplate(course){
 // Only public stops. Never persist the user's origin, route geometry, weather or signed ticket.
 return {id:course.id,name:course.name,scenery:course.mood,region:course.area,description:course.intro,
  waypoints:(course.waypoints??[]).map(p=>({id:p.id,name:p.name,latitude:p.latitude,longitude:p.longitude,description:p.description,accessStatus:p.accessStatus}))};
}
export function restoreBookmarks(storage){
 const templates=new Map();let legacy=[];
 try{legacy=JSON.parse(storage.getItem('gilgyeol-saved')??'[]');if(!Array.isArray(legacy))legacy=[];}catch{}
 try{
  const data=JSON.parse(storage.getItem('flowad-bookmarks-v2')??'[]');
  if(Array.isArray(data))for(const item of data){
   if(!item||!/^dyn-[\w-]{1,90}$/.test(item.id)||typeof item.name!=='string'||!Array.isArray(item.waypoints)||!item.waypoints.length)continue;
   const first=item.waypoints[0];
   if(!finite(first.latitude)||!finite(first.longitude))continue;
   templates.set(item.id,{...item,area:item.region,mood:item.scenery,scene:item.scenery,lat:first.latitude,lng:first.longitude,
    savedTemplate:true,km:0,minutes:0,apiMinutes:0,walk:0,spots:item.waypoints.map(p=>[p.name,'공개 POI · 현재 출발지로 재계산 필요']),tags:['저장한 명소 조합'],intro:item.description,
    route:{status:'RECALCULATION_REQUIRED',points:[],legs:[],geometryStatus:'NOT_AVAILABLE',terrainStatus:'UNAVAILABLE',warnings:['현재 출발지에서 다시 계산해야 합니다.']}});
  }
 }catch{}
 return {templates,legacyCount:legacy.filter(id=>typeof id==='string'&&!id.startsWith('dyn-')).length};
}
export function bookmarkCourse(course){return restoreBookmarks({getItem:key=>key==='flowad-bookmarks-v2'?JSON.stringify([bookmarkTemplate(course)]):'[]'}).templates.get(course.id);}
