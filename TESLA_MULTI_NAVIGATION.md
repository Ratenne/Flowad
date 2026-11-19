# Tesla 전체 경유지 어댑터와 Dry-run

2026-11-19. 기준: 원격 main `6cae5f6`, 작업 브랜치 `codex/tesla-multi-navigation`. 운영에서는 명시적 승인 후 전송을 허용하며 테스트 Worker는 dry-run 모드를 사용한다. 실제 차량 명령은 **COMMAND_NOT_SENT**다.

## 기존 실차 성공 경로 보존

사용자가 알려준 단일 목적지 실차 성공 이력과 `TESLA_ROAD_VALIDATION.md`의 사용자 관찰을 기준으로 기존 Java `TeslaIntegration` 및 현재 Workers `tesla.ts`/`tesla-client.ts`를 대조했다. 선택 지점의 좌표/명칭을 `navigation_request`의 `share_ext_content_raw`로 전달하는 경로다. Workers도 기존 OAuth 토큰 갱신, `vehicle_cmds`, 선택 차량·소유권 확인, CSRF, 온라인 상태 확인, 전송 시도 선저장, 사용자 차량 화면 확인을 사용한다. 이번 작업에서 실차 성공을 다시 재현했다는 뜻은 아니다.

배포 전 운영 버전은 `7d451e1d-3314-49ac-875c-fb08d6de8501`이다. 해당 버전의 바인딩 이름/설정을 확인했으며 OAuth 바인딩은 있고 `TESLA_COMMAND_PROXY_URL`과 다중 전송 플래그는 없다. 값·토큰·VIN·개인키는 출력하지 않았다. 현재 명령 전송 기본 주소는 기존 북미/아태 Fleet REST 호스트다. Proxy URL이 설정되면 기존 HTTPS origin을 사용한다. 새 프록시, OAuth 앱, 가상 키 등록 또는 키 교체는 하지 않았다.

## 공식 소스 확인과 지원 판정

공식 저장소를 `/tmp/flowad-tesla-vehicle-command`에 복제하여 README, `pkg/proxy/command.go`, `proxy.go`, 관련 테스트, `pkg/vehicle`, `pkg/protocol`, `cmd/tesla-http-proxy`를 확인했다. 공식 저장소는 수정하지 않았다.

- 확인한 main 커밋: `0a582da430c4aca6d397fb6cbed5b4d6bb380125` (2026-11-03).
- 최신 태그: `v0.4.1`, 커밋 `49977a18fd68567501d59e16a6c9e4a8b9348544`. 이것은 실행 중인 프록시 버전의 확인이 아니다. 운영에는 프록시 바인딩 자체가 없다.
- `navigation_request`는 `ErrCommandUseRESTAPI`를 반환하며, `ServeHTTP`가 원래 요청 본문을 REST로 전달한다. 공식 `TestVehicleCommandUseRESTAPIFallsBack`도 이 경로를 검사한다.
- `navigation_waypoints_request`, `navigation_gps_request` 분기는 두 확인 버전 모두 없다. 현재 일반 차량 명령 라우팅은 알 수 없는 명령을 `invalid_command`/400으로 끝내며 모든 미지원 명령을 자동 REST로 보내지 않는다. 일부 프로토콜 미지원 차량의 REST fallback은 별도 분기다. 이 예외로 모든 차종의 지원을 가정하지 않는다.

## 전송 계획

Waypoints는 출발지를 제외한 모든 경유지, 목적지, 복귀 지점의 Google Place ID를 방문 순서로 직렬화한다. 한 번의 요청에 `{"waypoints":"refId:<ID1>,refId:<ID2>"}`를 담는다. 하나라도 빠지면 명령 수는 0이다. GPS는 각 지점에 `{lat,lon,order}`를 생성한다. GPS가 기본 방식이며 첫 지점은 order 0으로 설정하고 이후에는 order 2로 추가한다. 이 값은 공개 구현을 기준으로 점검하며 공식 Fleet REST 문서는 복수 정차 순서를 설명한다. 숫자별 의미는 공개 구현을 근거로 하며 실차 동작은 미검증이다. 차량별 최대 정차 수는 미확인이다.

테스트 Worker는 dry-run을 사용한다. 운영 실차 시험은 기존 Fleet REST, 유효한 도로 검증 티켓, 선택 차량, 명령 권한, 전체 장소 확인 및 명시적 전송 승인이 필요하다. API 접수 이후 차량 화면에서 전체 경유지와 순서를 확인한다. GPS로 자동 전환하거나 실패한 명령을 반복하지 않는다.

## Google Maps 장소 매핑

Waypoints 전송 준비 선택 또는 장소 확인 재시도 시에만 공개 OSM POI를 검색한다. 개인 출발·복귀 좌표는 검색 대상에서 제외한다. places.id 마스크로 이름과 지역을 검색해 최대 3개 후보를 받고 location만 조회한다. 도로 접근점에서 10m 이내인 후보가 하나이고 다른 후보가 50m 이상 떨어져야 채택한다. 이름이나 영업장 층은 이 응답으로 검증할 수 없어 전송 전 Google Maps 링크로 확인한다.

서버는 D1에 POI별 ID를 보존하고 좌표 검증 결과는 7일 후 만료시켜 기존 정리 작업에서 삭제한다. POI별 잠금, 전체 동시 작업 2개, 개별 HTTP 3.5초, 코스 처리 45초 제한을 적용한다. 미일치는 하루, 일시 오류는 5분간 재검색을 제한한다.

글로벌 종량제 가격표상 Text Search Essentials (IDs Only)는 무료이고 Place Details Essentials는 월 10,000건까지 무료이며 다음 구간은 1,000건당 US$5다. 과금 계정 전체의 다른 앱 사용량도 고려해야 한다. Flowad 기본 한도는 검색 일 20건·월 600건, 위치 조회 일 60건·월 1,800건이다. Text Search의 location이나 displayName을 추가하면 Pro 과금이 가능하다. [공식 가격표](https://developers.google.com/maps/billing-and-pricing/pricing) · [Places 정책](https://developers.google.com/maps/documentation/places/web-service/policies)

운영자는 Google Cloud Console에서 Places API (New) 전용으로 키를 제한하고 해당 API의 Quotas에서 메서드별 허용 요청량을 조정한다. Billing → Budgets & alerts에서 대상 프로젝트와 Maps 서비스를 선택하고 실제·예상 지출 알림 수신자를 지정한다. 예산 알림은 요청을 차단하지 않는다. 서버 키는 workers 디렉터리에서 `npx wrangler secret put GOOGLE_PLACES_KEY`로 입력한다. 키가 없으면 외부 호출 없이 미설정 상태를 반환한다. Google 장소 정보는 별도 확인 화면에서 사용한다. [할당량과 비용 관리](https://developers.google.com/maps/billing-and-pricing/manage-costs) · [서비스별 약관](https://cloud.google.com/maps-platform/terms/maps-service-terms)
