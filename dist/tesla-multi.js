const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names=stops=>'<ol>'+stops.map(p=>'<li>'+safe(({RETURN:'복귀',DESTINATION:'최종 목적지'})[p.kind]||'경유 '+p.order)+' · '+safe(p.name)+'</li>').join('')+'</ol>';
function coverageMarkup(coverage){
 if(!coverage||coverage.complete)return '';
 const reasons={GOOGLE_PLACE_ID_MISSING:'확인된 Google 장소 정보 없음',GOOGLE_PLACE_IDENTITY_UNVERIFIED:'같은 장소인지 확인 필요',MAPPING_TARGET_CHANGED:'현재 경유지와 매핑 정보가 다름',GOOGLE_PLACE_LOCATION_MISMATCH:'실제 위치가 일치하지 않음'};
 return '<p>모든 지점의 Google 장소 정보가 확인돼야 한 번에 등록할 수 있어요. 현재 다음 지점 때문에 단일 요청을 만들 수 없어요.</p><ul>'+coverage.missing.map(p=>'<li>'+safe(p.order)+'. '+safe(p.name)+' · '+safe(reasons[p.reason]||'장소 정보 확인 필요')+'</li>').join('')+'</ul><p>경유지를 빼거나 가까운 다른 장소로 바꾸지 않아요.</p>';
}
export function multiEntryMarkup(id,enabled){
 if(!enabled)return '';
 return '<section><h4>Tesla 경유지 전송 준비</h4><p>경유지와 방문 순서를 확인한 뒤 차량 전송을 승인할 수 있어요.</p><label>점검 방식 <select id="teslaMultiStrategy"><option value="GPS_ORDERED">GPS · 방문 순서대로 추가</option><option value="WAYPOINTS">Waypoints · 전체 코스 한 번에 등록</option></select></label><button class="button-secondary" data-tesla-multi-preview="'+safe(id)+'">전체 코스 전송 준비 · 도로 확인</button><button class="button-secondary" data-copy-stops="'+safe(id)+'">전체 방문 순서 복사</button></section>';
}
export function multiPreviewMarkup(plan,courseId){
 const mapping=plan.strategy==='WAYPOINTS'&&!plan.googlePlaceCoverage?.complete?'<button class="button-secondary" data-map-places>Google Maps 장소 확인</button><button class="button-secondary" data-strategy="GPS_ORDERED" data-tesla-multi-preview="'+safe(courseId)+'">GPS 방식으로 준비</button>':'';
 const failures=(plan.mappingResults||[]).filter(r=>r.status==='UNMAPPED'||r.status==='PENDING');
 const reason=r=>({GOOGLE_PLACES_NOT_CONFIGURED:'장소 검색 연결 준비 중',PUBLIC_POI_REQUIRED:'공개 장소 정보 없음',GOOGLE_PLACE_LOCATION_MISMATCH:'장소와 경유지의 좌표 불일치',GOOGLE_PLACE_NOT_FOUND:'검색 결과 없음',GOOGLE_PLACE_MATCH_UNCERTAIN:'후보 구분 불가',GOOGLE_PLACES_CONFIGURATION_ERROR:'Google 인증 또는 요청 설정 확인 필요',GOOGLE_PLACES_UNAVAILABLE:'Google 요청 실패',GOOGLE_PLACES_DAILY_LIMIT:'오늘 검색 한도 도달',GOOGLE_PLACES_MONTHLY_LIMIT:'이번 달 검색 한도 도달'})[r.reason]||'위치 일치 확인 불가';
 const feedback=failures.length?'<ul>'+failures.map(r=>'<li>'+safe(r.name)+' · '+reason(r)+'</li>').join('')+'</ul><p>좌표별 순차 방식도 별도로 점검할 수 있어요.</p>':'';
 return mapping+feedback+'<h4>전체 드라이브 코스</h4><p>출발 · '+safe(plan.origin?.name??'차량 현재 위치')+'</p>'+names(plan.stops??[])+
 '<p>차량은 현재 위치에서 경로를 다시 계산해요. 모든 경유지와 '+(plan.roundTrip?'복귀 지점을':'최종 목적지를')+' 유지해요.</p>'+(plan.strategy==='GPS_ORDERED'?'<p>첫 지점으로 기존 경로를 교체하고, 나머지 지점을 방문 순서대로 추가해요.</p>':coverageMarkup(plan.googlePlaceCoverage))+'<button class="button-primary" data-tesla-multi-dry-run>전송 계획 확인</button><div id="teslaMultiResult" role="status">차량 명령 미전송 · 차량 내비 반영 미확인</div><button class="button-secondary" data-copy-stops="'+safe(courseId)+'">전체 방문 순서 복사</button><button class="button-secondary" data-tesla-preview="'+safe(courseId)+'">별도 기능 · 단일 목적지 전송</button>';
}
export function multiResultMarkup(result){
 const review=result.canSend&&result.status==='DRY_RUN_VALIDATED'?'<p>전송 차량 · 차대번호 끝 '+safe(result.vehicleSuffix)+'</p><ul>'+result.stops.map(s=>result.strategy==='GPS_ORDERED'?'<li>'+safe(s.name)+'</li>':'<li><a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query='+encodeURIComponent(s.name)+'&amp;query_place_id='+encodeURIComponent(s.googlePlace.id)+'">'+safe(s.name)+' · Google Maps</a></li>').join('')+'</ul><label><input type="checkbox" id="multiConsent"> 모든 장소와 순서를 확인했고 기존 차량 내비 경로 교체에 동의합니다.</label><button data-multi-send>전체 코스 보내기</button>':'';
 const messages={DRY_RUN_ONLY:'현재 운영 설정은 전송 계획 점검만 허용해요.',GPS_ORDER_OFFICIAL_CROSSCHECK_PENDING:'GPS 추가 동작은 차량에서 확인되지 않았어요.',PROXY_COMMAND_UNSUPPORTED:'설정된 명령 프록시에서 이 방식을 지원하는지 확인되지 않았어요.'};
 const limits=(result.blockers||[]).filter(key=>messages[key]).map(key=>'<p>'+messages[key]+'</p>').join('');
 if(result.commandStatus==='COMMAND_NOT_SENT')return review+limits+ '<p>'+(result.status==='DRY_RUN_VALIDATED'?(result.fulfillsSingleRequestGoal?'한 번의 요청에 전체 '+safe(result.stopCount)+'개 지점을 담는 계획을 검증했어요.':'별도 순차 방식의 '+safe(result.commandCount??0)+'개 요청 계획을 점검했어요. 단일 요청 등록과는 다른 방식이에요.'):'전체 코스를 등록할 요청을 만들지 않았어요.')+'</p>'+coverageMarkup(result.strategy==='GPS_ORDERED'?null:result.googlePlaceCoverage)+'<p>차량 명령 미전송 · 차량 내비 반영 미확인</p>';
 const progress=Number.isInteger(result.attemptedCommands)?'<p>시도 '+safe(result.attemptedCommands)+'건 · API 접수 '+safe(result.acceptedCommands)+'건</p>':'';
 const accepted=result.commandStatus==='COMMAND_API_ACCEPTED';
 return progress+'<p>'+(accepted?'Tesla API가 요청을 접수했어요.':result.error==='PARTIAL_COMMAND_ACCEPTANCE'?'일부 요청만 접수됐어요. 전체 코스 전송 완료가 아니에요.':result.error==='COMMAND_PROTOCOL_REQUIRED'?'차량에서 서명된 명령을 요구해 전송을 중단했어요.':result.error==='UNSUPPORTED_COMMAND'?'이 차량 또는 명령 경로에서 해당 방식을 지원하지 않아요.':result.error==='COMMAND_REJECTED'?'Tesla가 전체 코스 요청을 거부했어요.':'전송 결과를 확정할 수 없어요.')+'</p><p>'+(result.vehicleNavigationStatus==='VEHICLE_NAVIGATION_CONFIRMED'?'사용자가 전체 방문 순서를 차량 화면에서 확인했어요.':'차량 내비 반영 미확인 · 다시 보내기 전에 차량 화면을 확인하세요.')+'</p>'+(result.requiresVehicleCheck?'<label><input type="checkbox" id="teslaMultiOrderConfirmed"> 차량 화면에서 모든 경유지와 방문 순서를 확인했습니다.</label><button class="button-secondary" data-tesla-multi-confirm="true">전체 목록 일치</button><button class="button-secondary" data-tesla-multi-confirm="false">일치하지 않음</button>':'');
}
