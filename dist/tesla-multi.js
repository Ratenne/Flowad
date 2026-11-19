const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names=stops=>'<ol>'+stops.map(p=>'<li>'+safe(({RETURN:'복귀',DESTINATION:'최종 목적지'})[p.kind]||'경유 '+p.order)+' · '+safe(p.name)+'</li>').join('')+'</ol>';
function coverageMarkup(coverage){
 if(!coverage||coverage.complete)return '';
 const reasons={GOOGLE_PLACE_ID_MISSING:'확인된 Google 장소 정보 없음',GOOGLE_PLACE_IDENTITY_UNVERIFIED:'같은 장소인지 확인 필요',MAPPING_TARGET_CHANGED:'현재 경유지와 매핑 정보가 다름',GOOGLE_PLACE_LOCATION_MISMATCH:'실제 위치가 일치하지 않음'};
 return '<p>모든 지점의 Google 장소 정보가 확인돼야 한 번에 등록할 수 있어요. 현재 다음 지점 때문에 단일 요청을 만들 수 없어요.</p><ul>'+coverage.missing.map(p=>'<li>'+safe(p.order)+'. '+safe(p.name)+' · '+safe(reasons[p.reason]||'장소 정보 확인 필요')+'</li>').join('')+'</ul><p>경유지를 빼거나 가까운 다른 장소로 바꾸지 않아요.</p>';
}
export function multiEntryMarkup(id,enabled){
 if(!enabled)return '';
 return '<section><h4>전체 코스를 한 번의 요청으로 등록</h4><p>실제 전송 전 점검 기능이에요. 차량 명령은 보내지 않아요.</p><label>점검 방식 <select id="teslaMultiStrategy"><option value="WAYPOINTS">전체 코스 한 번에 등록</option><option value="GPS_ORDERED">별도 방식 · 좌표별 순차 요청</option></select></label><button class="button-secondary" data-tesla-multi-preview="'+safe(id)+'">전체 코스 전송 준비 · 도로 확인</button><button class="button-secondary" data-copy-stops="'+safe(id)+'">전체 방문 순서 복사</button></section>';
}
export function multiPreviewMarkup(plan,courseId){
 const mapping=plan.strategy==='WAYPOINTS'&&!plan.googlePlaceCoverage?.complete?'<button class="button-secondary" data-map-places>Google Maps 장소 확인</button>':'';
 const failures=(plan.mappingResults||[]).filter(r=>r.status!=='MAPPED');
 const reason=r=>({GOOGLE_PLACES_NOT_CONFIGURED:'장소 검색 연결 준비 중',PUBLIC_POI_REQUIRED:'공개 장소 정보 없음',GOOGLE_PLACES_DAILY_LIMIT:'오늘 검색 한도 도달',GOOGLE_PLACES_MONTHLY_LIMIT:'이번 달 검색 한도 도달'})[r.reason]||'위치 일치 확인 불가';
 const feedback=failures.length?'<ul>'+failures.map(r=>'<li>'+safe(r.name)+' · '+reason(r)+'</li>').join('')+'</ul><p>좌표별 순차 방식도 별도로 점검할 수 있어요.</p>':'';
 return mapping+feedback+'<h4>전체 드라이브 코스</h4><p>출발 · '+safe(plan.origin?.name??'차량 현재 위치')+'</p>'+names(plan.stops??[])+
 '<p>차량은 현재 위치에서 경로를 다시 계산해요. 모든 경유지와 '+(plan.roundTrip?'복귀 지점을':'최종 목적지를')+' 유지해요.</p>'+(plan.strategy==='GPS_ORDERED'?'<p>이것은 지점별 순차 요청 방식이에요. 전체 코스 단일 요청의 대체 방식이 아니에요.</p>':coverageMarkup(plan.googlePlaceCoverage))+'<p>실제 차량 지원 확인 전에는 전송할 수 없어요.</p><button class="button-primary" data-tesla-multi-dry-run>전체 요청 계획·보안 조건 점검</button><button class="button-primary" disabled>전체 코스 보내기 · 현재 제한됨</button><div id="teslaMultiResult" role="status">차량 명령 미전송 · 차량 내비 반영 미확인</div><button class="button-secondary" data-copy-stops="'+safe(courseId)+'">전체 방문 순서 복사</button><button class="button-secondary" data-tesla-preview="'+safe(courseId)+'">별도 기능 · 단일 목적지 전송</button>';
}
export function multiResultMarkup(result){
 const review=result.canSend&&result.status==='DRY_RUN_VALIDATED'?'<ul>'+result.stops.map(s=>'<li><a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query='+encodeURIComponent(s.name)+'&amp;query_place_id='+encodeURIComponent(s.googlePlace.id)+'">'+safe(s.name)+' · Google Maps</a></li>').join('')+'</ul><label><input type="checkbox" id="multiConsent"> 모든 장소와 순서를 확인했고 기존 차량 내비 경로 교체에 동의합니다.</label><button data-multi-send>전체 코스 보내기</button>':'';
 if(result.commandStatus==='COMMAND_NOT_SENT')return review+ '<p>'+(result.status==='DRY_RUN_VALIDATED'?(result.fulfillsSingleRequestGoal?'한 번의 요청에 전체 '+safe(result.stopCount)+'개 지점을 담는 계획을 검증했어요.':'별도 순차 방식의 '+safe(result.commandCount??0)+'개 요청 계획을 점검했어요. 단일 요청 등록과는 다른 방식이에요.'):'전체 코스를 등록할 요청을 만들지 않았어요.')+'</p>'+coverageMarkup(result.strategy==='GPS_ORDERED'?null:result.googlePlaceCoverage)+'<p>차량 명령 미전송 · 차량 내비 반영 미확인</p>';
 const accepted=result.commandStatus==='COMMAND_API_ACCEPTED';
 return '<p>'+(accepted?'Tesla API가 요청을 접수했어요.':result.error==='PARTIAL_COMMAND_ACCEPTANCE'?'일부 요청만 접수됐어요. 전체 코스 전송 완료가 아니에요.':result.error==='COMMAND_REJECTED'?'Tesla가 전체 코스 요청을 거부했어요.':'전송 결과를 확정할 수 없어요.')+'</p><p>'+(result.vehicleNavigationStatus==='VEHICLE_NAVIGATION_CONFIRMED'?'사용자가 전체 방문 순서를 차량 화면에서 확인했어요.':'차량 내비 반영 미확인 · 다시 보내기 전에 차량 화면을 확인하세요.')+'</p>'+(result.requiresVehicleCheck?'<label><input type="checkbox" id="teslaMultiOrderConfirmed"> 차량 화면에서 모든 경유지와 방문 순서를 확인했습니다.</label><button class="button-secondary" data-tesla-multi-confirm="true">전체 목록 일치</button><button class="button-secondary" data-tesla-multi-confirm="false">일치하지 않음</button>':'');
}
