# 추천 요청·오류 처리

설정 창의 값을 바꿀 때는 추천 요청을 보류하고, 적용 버튼 또는 창 닫기 시 변경된 조건을 한 번 전송한다. 적용 버튼은 실패 후 재시도도 수행한다. 변경 없는 성공 결과와 이미 진행 중인 동일 요청에는 추가 요청을 보내지 않는다. 위치 확인 중에는 위치 완료 안내를 유지한다.

같은 조건의 서버 중복 요청은 `requestId`가 달라도 진행 중인 계산을 공유한다. 요청 ID는 추천 조건이 아니다. 각 계산은 기존 제한 시간과 동시성 제한을 유지하며, 브라우저 연결 종료 후에도 제한된 정리 작업을 `waitUntil`에 연결해 D1 슬롯 반환을 수행한다. 외부 요청 지연·런타임 강제 종료에 대비한 기존 슬롯 만료도 유지한다.

도로 서버가 HTML 등 비JSON 본문으로 HTTP 429를 반환해도 JSON 오류보다 요청 제한을 우선 분류한다. API는 기존 오류 형태인 `{error: ...}`를 유지하면서 `ROAD_PROVIDER_RATE_LIMIT`과 HTTP 503, `Retry-After`를 반환한다. 공급자가 대기 시간을 주지 않으면 30초, 값이 있으면 최대 300초까지 사용한다. 브라우저는 이 시간 동안 자동 재시도하거나 버튼 클릭으로 추가 요청을 보내지 않는다. 대기 후 명시적인 재조회가 필요하다. `ROAD_TABLE_UNAVAILABLE`과 `RECOMMENDATION_BUSY`도 위치 측정 오류와 구분해 표시한다.

운영 로그에서 도로 Table 응답 HTTP 429와 후속 추천 요청의 503을 확인했다. 이 수정은 중복 호출과 오류 처리를 개선하며 외부 도로 서버의 가용성이나 요청 제한 해제를 보장하지 않는다. 오류 로그에는 좌표·공급자 응답 본문·비밀키를 기록하지 않는다. 실제 경로 실패를 추정 경로 성공으로 바꾸지 않는다.

## Render 서버 간 연결 차단 (2026-11-17)

운영 추천 POST를 대전 중심 공개 좌표로 실행해 `ROAD_PROVIDER_RATE_LIMIT`을 재현했다. 격리 Cloudflare 원격 preview에서도 기존 `flowad-roads.onrender.com`의 Table뿐 아니라 `/` 요청이 HTTP 429, `cf-mitigated: challenge`, HTML `Just a moment...`를 반환했다. 같은 PC에서 직접 요청한 `/`는 OSRM `InvalidUrl` JSON을 반환했다. 이는 OSRM 계산 전에 Render 앞단 Cloudflare 보안 계층에서 서버 간 요청이 차단된 증거다. 공급자의 비공개 탐지 규칙, IP별 임계값은 확인할 수 없으며 `unlimited`나 PC의 위치 권한을 원인으로 단정하지 않는다.

동일 Render 서비스에 `flowad-roads.ravirgo.com`을 정식 custom domain으로 등록하고 DNS CNAME을 기존 서비스로 연결했다. TLS 인증서를 확인한 뒤 Worker의 `ROAD_ROUTING_URL`만 새 주소로 전환한다. OSM 그래프·도로 스냅 제한·후보 수·반경 정책·사용자 위치 탐색은 유지한다. 기존 호스트의 보안 설정을 끄거나 브라우저 challenge/clearance를 자동 해결하지 않는다. 공개 장소 두 좌표를 반복한 22×22 Table을 기존 `100;unlimited;...;100` 옵션으로 새 도메인에 요청해 HTTP 200, `Ok`, 유효한 행렬을 확인했다. 이 점검은 실제 서로 다른 20개 POI 코스의 검증과 구분한다.

`httpJson`은 공식 `cf-mitigated: challenge` 헤더를 감지하면 HTML을 읽지 않고 본문 스트림을 취소한다. Table/Route는 `ROAD_PROVIDER_CHALLENGE`로 구분하고 UI도 연결 설정 문제로 안내한다. Route 단계에서 challenge가 발생하면 나머지 후보 호출을 중단한다. 진짜 HTTP 429는 기존 `ROAD_PROVIDER_RATE_LIMIT`/Retry-After 정책을 유지한다. 단순 30초 재시도로 보안 검증이 해결된다고 안내하지 않는다.

DNS/인증서 변경은 Render 공식 custom domain 및 Cloudflare DNS 절차를 따른다. 무료 플랜 유휴 종료와 콜드 스타트는 별도 제약으로 남는다. 롤백은 Git의 이전 `ROAD_ROUTING_URL` 값으로 되돌릴 수 있으나, 기존 호스트의 차단이 재발할 수 있어 정상 복구 수단으로 보장하지 않는다. 도메인은 다른 자원에서 참조하지 않는 것을 확인하기 전에 삭제하지 않는다.

참고: [Challenge 응답 식별](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/), [Render Cloudflare DNS](https://render.com/docs/configure-cloudflare-dns).

## 브라우저 예보 조회 회복 (2026-11-18)

날씨는 브라우저가 Open-Meteo에 직접 요청한다. 도로 서버 주소와 무관하며, 키나 별도 환경 변수는 사용하지 않는다. 확인 시 PC의 첫 직접 연결은 네트워크 오류로 실패했지만 동일 요청의 재조회는 HTTP 200/48시간 예보였고 격리 Cloudflare에서도 정상 응답했다. 같은 PC의 운영 화면에서 대전 출발·코스 주변 예보, 기온·바람 표시를 확인했다. 당시 모든 실패의 외부 원인이나 지난주의 네트워크 상태까지 확정한 것은 아니다.

기존 코드는 한 번의 실패에 즉시 예시 날씨로 전환하고, 추가 코스 예보 실패 시 이미 받은 출발지 예보도 삭제했다. 이제 `weather-client.js`가 정상 응답에는 한 번만 요청하며, 연결 오류·시도당 6초 초과·HTTP 5xx에 한해 최대 한 번 더 시도한다. 전체 14초 제한은 유지한다. HTTP 429/403, 잘못된 JSON/예보 데이터, 취소에는 추가 요청을 하지 않는다. 진행 중 재조회는 합치고 타이머·중단 리스너를 정리한다.

추가 코스 조회 실패 시 현재 출발지의 유효한 기존 예보만 유지하며 `코스 예보 조회 실패 · 출발지 예보 적용`을 표시한다. 90분 이내의 대상 시각을 갖는 예보가 없거나 출발지가 바뀌면 이전 예보를 재사용하지 않는다. 심각 기상 플래그를 유지하고 수동 변경/취소 뒤 늦은 응답을 무시한다. 오류는 연결·시간 초과·요청 제한·형식 오류로 구분한다. 예보 재조회 버튼은 오류 후 실제 새 요청을 보낸다. 좌표 반올림, 외부 제공자, 전송 항목은 기존과 같으며 키·유료 API·서버 프록시를 추가하지 않는다.

검증: `node scripts/test-weather.mjs` 및 `npm run check:ci`(workers). 재시도/실패 보존/취소는 Mock 검증이고, 실제 공급자 정상 응답과 운영 UI 표시는 별도로 확인한다. 정상 상태의 외부 요청 수는 늘리지 않는다.

검증: `npm run check:ci`(workers), `node scripts/test-recommendation-settings.mjs`(저장소 루트). 설정 적용·재시도는 브라우저/API Mock, 공급자 429·중복 계산·요청 취소·슬롯 반환은 로컬 Workers/D1 Mock으로 검증한다. 실제 차량 명령과 운영 추천 POST 테스트는 실행하지 않는다.
