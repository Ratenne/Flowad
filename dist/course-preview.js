const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
export function actualRoadPoints(course){
 const legs=course.route?.legs;
 if(course.route?.status!=='ROAD_ROUTED'||!Array.isArray(legs)||!legs.length||legs.some(l=>!Array.isArray(l.geometry)||l.geometry.length<2||l.geometry.some(p=>!valid(p))))return [];
 const points=legs.flatMap(l=>l.geometry);return points.length<=100000?points:[];
}
export function previewMarkup(course){
 const points=(course.route?.points??[]).filter(valid),geometry=actualRoadPoints(course);
 const verified=geometry.length>1,line=verified?geometry:points;
 if(!line.length)return '<p class="preview-empty">경유지 위치가 없어 미리보기를 준비하지 못했어요. 상세 정보에서 방문 순서를 확인하세요.</p>';
 const sx=p=>p.longitude*Math.cos(line[0].latitude*Math.PI/180),sy=p=>-p.latitude,xs=line.map(sx),ys=line.map(sy),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(500/Math.max(.005,maxX-minX),245/Math.max(.005,maxY-minY));
 const at=p=>[(sx(p)-(minX+maxX)/2)*scale+320,(sy(p)-(minY+maxY)/2)*scale+175];
 const path=line.filter((_,i)=>i%Math.max(1,Math.ceil(line.length/1000))===0||i===line.length-1).map(p=>at(p).join(',')).join(' ');
 const stops=points.filter(p=>p.type!=='RETURN');
 return '<svg class="course-sketch" viewBox="0 0 640 360" role="img" aria-label="'+escape(course.name)+' · '+(verified?'검증된 도로 경로':'경유지 방문 순서 · 실제 도로 아님')+'"><path d="M20 90H620M20 175H620M20 260H620M150 20V330M320 20V330M490 20V330" class="sketch-grid"/><polyline points="'+path+'" class="sketch-route" '+(verified?'':'stroke-dasharray="8 8"')+'/>'+stops.map((p,i)=>{const [x,y]=at(p);return '<g><circle cx="'+x+'" cy="'+y+'" r="13" class="sketch-stop"/><text x="'+x+'" y="'+(y+4)+'" text-anchor="middle" class="sketch-number">'+(p.type==='ORIGIN'?'출발':i)+'</text><text x="'+Math.max(80,Math.min(560,x))+'" y="'+(y+32)+'" text-anchor="middle" class="sketch-label">'+escape(p.name.slice(0,20))+'</text></g>';}).join('')+'</svg><p class="preview-caption">'+(verified?'실제 도로 연결을 확인한 코스입니다.':'점선은 방문 순서이며 실제 주행 도로가 아닙니다.')+'</p>';
}
