const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const integrations=['none','tesla','pleos','other'];
export function connectionSection(course,integration,nativeSupported,teslaConnected=false){
 const id=safe(course.id),options=[['none','연동 없이 사용'],['tesla','Tesla'],['pleos','Pleos 지원 차량'],['other','기타 차량']].map(([value,label])=>`<option value="${value}" ${value===integration?'selected':''}>${label}</option>`).join('');
 const road='<button class="button-secondary" data-road-verify="'+id+'">실제 도로 확인</button>';
 let action='<p>차량 연결은 선택 사항이에요. 코스 탐색과 저장은 그대로 사용할 수 있어요.</p><button class="button-primary" data-open-vehicle>내 차량 연결 방식 선택</button>';
 if(integration==='tesla')action='<p>Tesla 계정과 차량을 연결한 뒤 정차 중 전송해 주세요. 한 지점으로 목적지를 교체하며, 전체 경유지 일괄 전송은 지원하지 않습니다.</p><button class="button-primary" data-tesla-preview="'+id+'">차량 전송 준비 · 도로 확인</button><div id="teslaNavigationPreview" role="status"></div>';
 if(integration==='tesla'&&!teslaConnected)action='<p>Tesla 계정을 연결하면 차량으로 목적지를 보낼 수 있어요. 코스 탐색에는 로그인이 필요하지 않아요.</p><button class="button-primary" data-open-vehicle>Tesla 계정 연결하기</button>';
 if(integration==='pleos')action=nativeSupported?'<p>도로 확인 후 차량 화면에서 경유지와 순서를 확인해 주세요.</p><button class="button-primary" data-native-route="'+id+'">차량 내비로 연결</button>':'<p>Pleos 지원 차량의 전용 앱에서 연결할 수 있어요. 현재 브라우저에서는 코스와 경유지를 확인해 주세요.</p><button class="button-primary" disabled>차량 앱에서 연결 가능</button>';
 if(integration==='other')action='<p>경유지를 차량 내비게이션에서 순서대로 검색해 주세요. 이 차량으로 자동 전송하는 기능은 제공하지 않습니다.</p><button class="button-primary" data-copy-stops="'+id+'">경유지 이름 복사</button>';
 return '<section class="vehicle-access navigation-panel"><h3>차량 내비로 연결</h3><label>연결 방식 <select data-detail-integration aria-label="차량 연결 방식">'+options+'</select></label>'+(integration==='tesla'||integration==='pleos'&&nativeSupported?'':road)+'<div id="roadVerificationResult" role="status">'+(course.route?.status==='ROAD_ROUTED'?'실제 도로 연결을 확인했어요. 현재 통행과 주차는 별도 확인해 주세요.':'거리·시간은 추정이에요. 차량으로 보내기 전 도로 확인이 필요해요.')+'</div>'+action+'</section>';
}
