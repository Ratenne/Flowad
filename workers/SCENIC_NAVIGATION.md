# 경유지·선택 코스 도로 검증 수정 (2026-11-19)

기준 소스는 원격 main `9c406f8`이다. 작업 시작 시 로컬 `codex/pleos-integration`은 운영보다 오래되어 수정하지 않고 보존했으며, 최신 main에서 `codex/restore-scenic-waypoints`를 만들었다. 운영은 `flowad-api`, Route는 `ravirgo.com/flowad*`, 도로 제공자는 기존 `https://flowad-roads.ravirgo.com`이다. 과거 stage2 설정이나 onrender 호스트로 운영을 되돌리지 않는다.

## 원인과 경유지 계약

- 기본 동적 추천은 이미 모든 POI를 `route.points`와 티켓에 넣지만, 1개 명소 계획도 상위 후보에 포함했고 왕복의 마지막 명소를 목적지와 구분하지 않았다. 대표 3D 영역은 멀리 떨어진 명소를 생략할 수 있다. 이 대표 마커를 전체 코스와 혼동하면 목적지만 남은 것처럼 보인다.
- Tesla 미리보기는 같은 좌표를 전역 중복 제거하여 중간 방문을 제거할 수 있었다. 현재는 서명된 전체 순서를 그대로 준비하며, 실제 명령은 기존의 선택한 단일 목적지 교체다.
- Pleos는 동적 ID에 들어가는 대문자·밑줄과 `DESTINATION`을 거부했다. 검증된 동적 왕복·편도 모두 수용하도록 수정했다. 추정 경로는 네이티브에서도 거부한다.

기본 추천은 `ORIGIN → SCENIC_WAYPOINT… → DESTINATION → RETURN(왕복)`이며, 별도 `origin`, `scenicWaypoints`, `destination`, `returnPoint`도 같은 points에서 만든다. 2개 이상의 명소를 방문할 수 있으면 중간 경유지가 있는 조합을 우선 사용한다. 후보 수·반경은 유지한다. 150m 미만의 중복 명소는 기존 규칙으로 제외하며 과도한 바깥길 우회를 제한한다. 저장 코스의 `poiIds`는 방문 순서를 보존한다. 조건상 한 명소만 가능하면 목적지만 있는 대안이 반환될 수 있다.

추천은 도로 Geometry 없이 추정 경유지 목록과 미검증 티켓을 반환한다. 이 단계에서 차량 전송은 허용하지 않는다. 도로 검증은 모든 points에 기존 100m radiuses를 적용한 하나의 OSRM Route 요청이다. 검증 후 새 티켓과 resolve, Tesla 준비 목록 및 Pleos 구간 분할에서 동일한 방문 순서를 유지한다. 공개 명소 메타데이터는 풍경의 실측 평가나 현재 진입·주차 안전 확인이 아니다.

Tesla 웹 준비도 먼저 `/api/navigation/verify`를 호출한다. 검증 티켓에는 도로 구간 요약(거리·시간, Geometry 제외)을 추가로 서명하며, 준비 API는 유효한 요약을 재사용하여 같은 코스를 OSRM에 두 번 보내지 않는다. 티켓 v1과 기존 points 계약은 유지하고 과거 티켓은 기존 검증 경로를 사용한다. 준비 계획은 검증 티켓의 원래 만료 시각을 넘지 않으며 준비를 반복해 유효 시간을 연장하지 않는다.

## 503·400과 Render 준비

운영의 이전 기록(`RECOMMENDATION_FAILURES.md`)에는 Render 앞단 HTTP 429 및 challenge가 있다. 현재 선택 코스 Route에는 Table용 준비 대기가 적용되지 않았고, 8초 통신 제한과 모든 통신 오류를 합친 503이 남아 있었다. 이번 확인에서 기존 운영의 정상 Route 응답도 재현했다. 기존 사용자의 모든 503을 절전 탓으로 단정할 근거는 없다.

`/api/navigation/readiness`는 운영 점검용으로 공개 기준점의 OSRM nearest JSON을 확인한다. 미준비 응답은 202다. 브라우저의 코스 검증은 선택한 코스의 Route를 바로 요청하며 별도의 readiness 호출이나 폴링을 하지 않는다. 정상 Route 응답은 readiness 정상 캐시에도 반영한다. Tesla 전송 준비에서 이미 검증된 티켓을 재사용하며 서버는 티켓 서명과 만료를 확인한다. readiness 요청은 8초, Route는 25초로 제한한다.

- Route 시간 초과: `ROAD_PROVIDER_TIMEOUT`/503. 연결 실패: `PROVIDER_UNAVAILABLE`/503. HTTP 상태와 소요 시간·지점 수만 진단 로그에 기록한다.
- 429: `ROAD_PROVIDER_RATE_LIMIT`/503 및 Retry-After. challenge, 403과 구분한다. 알려진 OSRM 호스트별 대기 시간을 기존 D1에 공유하고, 대기 종료 후 한 Worker 요청만 먼저 원본을 확인한다. Route·Nearest·Table에 공통 적용하며 Table도 429에서 자동 재시도하지 않는다.

2026-11-20 운영 조사에서 Cloudflare 요청 분석의 공개 기준점 `/nearest` 429 표본 5건(07:45, 07:46, 07:47, 08:34, 09:21 KST)은 모두 원본과 에지 상태가 429였다. 동일 호스트의 Security Events 조회 결과는 0건이었다. Render 애플리케이션 로그에는 09:25:42 KST OSRM 기동이 기록됐다. 복귀 후 커스텀 도메인과 `flowad-roads.onrender.com`에서 같은 nearest 요청이 HTTP 200과 OSRM `Ok`를 반환했다. Render 무료 플랜의 요청 로그는 비활성이라 과거 429의 원본 헤더·임계값을 복원할 수 없었다. Worker는 이후 실패 응답의 상태, Retry-After와 사용 가능한 Render 라우팅·연관 ID만 기록한다. Cloudflare 보안 규칙은 변경하지 않았다.
- `NoSegment`: `WAYPOINT_TOO_FAR_FROM_ROAD`/400. OSRM 메시지에 좌표 인덱스가 있거나 스냅 거리 검사에서 실패하면 `waypointOrders`와 `courseId`를 응답한다. 화면에는 해당 지점 이름만 표시한다. 제공자가 인덱스를 주지 않으면 임의로 추측하지 않는다.
- `NoRoute`: `NO_ROAD_ROUTE`/400. 잘못된 입력은 `INVALID_REQUEST`/400.
- 서명 검증이 끝난 만료 티켓은 `TICKET_EXPIRED`/400, 변조·형식 오류는 `INVALID_TICKET`/400이다. 추천에 별도 서명된 `selectionToken`을 함께 반환한다. 이 값은 30분 동안 `/api/navigation/verify`에만 사용할 수 있다. 사용자가 직접 다시 확인하고 전체 경로가 기존 100m 검사에 통과하면 새 5분 검증 티켓을 만든다. 기존 티켓도 verify에 계속 사용할 수 있으며 같은 요청에 두 자격을 함께 보내면 거부한다. resolve, Tesla, Pleos는 기존 Navigation Ticket 계약을 사용한다.
- 브라우저의 공통 진행 잠금과 같은 isolate의 동일 검증 Promise 공유로 동시 중복을 막는다. 완료 후 캐시하지 않아 수동 재시도가 가능하다. 전역 isolate 간 요청 병합을 보장하지는 않는다.

## 차량별 범위와 지도

Tesla 공식 문서는 `navigation_waypoints_request`(목록)와 `navigation_gps_request`(order)를 문서화한다. 다중 경유지 API 자체가 없다고 단정하지 않는다. 다만 공개 문서에서 요청 스키마·최대 수·차종/펌웨어별 조건을 확보하지 못했고 실차를 조회하지 않았다. 요청 본문을 추측하여 새 명령을 보내지 않는다. 현재 Flowad는 기존 `navigation_request` 단일 목적지 교체, 전체 방문 순서 표시 및 미리보기를 유지한다. 성공 응답은 전체 경유지 전송 성공이 아니다.

Pleos는 기존 NaviHelper 어댑터의 구간당 최대 2개 경유지+목적지 계약을 사용한다. 전 구간을 보존하되 다음 구간은 사용자 확인과 도착 상관관계가 필요하다. 이번 APK 빌드·단위 테스트는 실제 SDK 이벤트·도착·차량 내비 반영 성공을 의미하지 않는다. 웹 브리지 호출 문구도 ‘차량 앱에 확인 요청’으로 표시한다. 기타 차량은 출발·경유·목적지·복귀 전체 순서를 보고 이름을 복사한다.

Naver 공식 배포 SDK `maps.js`에서 `kr-col-ext.nelo.navercorp.com/_store`는 `log`, `logLevel`, `projectName`, `projectVersion`을 보내는 별도 XMLHttpRequest이며 예외가 내부 처리된다. 기존 CSP를 유지한 운영 Chrome에서 지도 타일과 출발지 마커가 정상 표시되는 것을 확인했다. 이 로그 도메인을 connect-src에 추가하지 않는다. 기존 Copernicus 지형 파일·색상·음영·렌더러·대표 마커와 2D fallback은 변경하지 않았다.

## 검증·배포·복구

공유 대기 상태를 도입한 Worker 배포 전에 기존 운영 D1에 `0006_road_provider_cooldown.sql`을 적용한다. 테이블은 제공자 origin과 두 타임스탬프만 저장한다. 경유지 좌표·추천 선택 토큰·Navigation Ticket은 이 테이블에 기록하지 않는다.

`npm run check:ci`에 readiness 검사를 추가했다. 회귀 검사는 기본 추정 추천의 경유지·목적지 분리, 편도/왕복, 저장 순서, 전체 좌표의 단일 Route 전송, 검증 티켓 resolve, Tesla 준비(명령 없음), 지연/503/429/challenge/NoSegment/NoRoute/입력 오류/티켓 만료 및 동시 검증·수동 재시도를 포함한다. Android는 `scripts/pleos-gradle.sh testDebugUnitTest assembleDebug assembleDebugAndroidTest`로 확인한다. 실제 기기 없이 계측 APK 빌드만으로 기기 테스트 통과를 주장하지 않는다.

테스트 Worker `flowad-navigation-qa.o94777.workers.dev`는 별도 임의 테스트 서명 키를 사용한다. 기존 D1 공개 POI를 읽고 기존 요청 슬롯/할당량을 사용하며 스키마·활성 포인터·운영 Secret·Route는 변경하지 않는다. 실제 추천→OSRM 검증→새 티켓 resolve에서 순서를 비교한다. 부산 공개 좌표의 자동 추천, 편도, 공개 데이터의 송정·일광 명소 ID로 저장 코스를 재계산하는 시나리오를 사용한다. 특정 장소나 코스를 서비스 코드에 하드코딩하지 않는다.

최종 로컬 검사는 Worker 184개와 CI의 프런트엔드·지형 검사를 통과했다. 테스트 Worker의 자동 추천 5개, 편도 추천 5개 및 송정→일광 저장 조합에서 검증·resolve HTTP 200과 전체 points 일치를 확인했다. Chrome 화면에서는 범어사 포함 코스의 도로 연결 실패가 ‘범어사’ 이름으로 표시되고, 다른 코스는 91.1km·2시간 7분 도로 검증 완료로 표시되는 것을 확인했다. 390px 상세, 코스 전환, 해발 0–702m 지형과 번호 마커, 지형 재시도도 확인했다. 실제 Render 절전은 강제로 유발하지 않았다. 재실행: `node scripts/verify-scenic-navigation.mjs --test-worker` 또는 `--allow-production-requests` (후자는 운영 요청).

배포 직전 운영 버전은 `4972c1ff-e50f-4b70-8d9f-772bc3a96d36`다. 문제 시 workers에서 `npx wrangler rollback 4972c1ff-e50f-4b70-8d9f-772bc3a96d36 --config wrangler.jsonc`를 실행한다. GitHub 자동 배포를 사용했다면 해당 수정 커밋을 revert하여 재배포한다. DB/Secret/Route 복원이나 Render 변경은 필요 없다. 실제 차량 명령은 실행하지 않는다.

실제 Render 절전 전후의 통제 실험, 장기간 제공자 가용성, 실제 Tesla/Pleos 차량 반영은 미검증이다. 정상 운영 API 응답은 해당 시점의 도로 연결만 확인하며 전체 명소의 안전을 보장하지 않는다.

공식 자료: [Tesla 명령](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands), [Tesla 프록시](https://github.com/teslamotors/vehicle-command/blob/main/pkg/proxy/command.go), [Render Free](https://render.com/docs/free), [Naver SDK](https://oapi.map.naver.com/openapi/v3/maps.js).
