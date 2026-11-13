# Flowad 개발 1/4 — 백엔드 이전 및 로컬 검증

작성일: 2026-11-12. 범위는 TypeScript 백엔드와 로컬 검증이다. 실제 배포, DNS, Tesla 실 API/OAuth/명령, Pleos SDK 설치·실행, APK 빌드를 수행하지 않았다. 기존 `backend/`, `dist/`, `cloudflare/`, `pleos-android/` 파일은 변경하지 않았다.

## 1. 기존 구현 분석

| 영역 | 현재 소스에서 확인한 구조 |
| --- | --- |
| 실행 환경 | `backend/pom.xml`: Spring Boot 3.5.7, Java 17. 이번 테스트 JVM은 17.0.12 |
| 의존성 | Spring Web/Test, sqlite-jdbc 3.50.3.0, JTS 1.20.0, Proj4J 1.4.3 |
| Controller | `Application`, `TeslaStatusController`, `NavigationTicketController`, `LocationAddress`, `JusoMapController`, `Charging`. DTO는 각 클래스 안의 Java record |
| Service | `Routing`, `TeslaIntegration`, `TeslaNavigationAdapter`, `NavigationTickets`. RoadProvider/Gateway 인터페이스로 HTTP와 계산 분리 |
| Repository | JPA/ORM 없음. 추천은 resources의 courses/anchors JSON. 주소만 읽기 전용 로컬 SQLite+RTree+WKB/JTS 사용 |
| 상태 | Tesla HttpSession 30분. OAuth state 5분, 토큰·VIN·선택 차량·CSRF·명령 계획은 서버 메모리. 명령 계획 5분·계획당 1회 |
| HTTP | Java HttpClient. Tesla 고정 북미·아태 audience, token/authorize 별도 도메인. ROAD_ROUTING_URL이 있으면 OSRM, 없으면 직선 추정. 주소 지도는 HTML의 공식 브라우저 스크립트 |
| 예외 | 추천 400 `{error:"Invalid recommendation request"}`. Tesla 일반 오류 400, HTTPS/CSRF 403, 미설정 503. 티켓 오류·주소 오류는 빈 body. 기타 Spring 기본 4xx/5xx 오류는 통일된 공통 DTO가 아님 |
| 프런트 | `dist/app.js`, `dist/tesla-check.html`에서 `./api/...` 호출. same-origin 세션 쿠키와 X-CSRF-Token. Juso는 form POST. 현재 기존 Worker는 ravirgo.com/flowad → Render 프록시 |
| Pleos | Android `RecommendationVerifier`가 `https://ravirgo.com/flowad/api/navigation/resolve` 호출. 서버 전용 Pleos REST 제공자는 없음 |
| 검증 자료 | 기존 Java 테스트 50개, 프런트 Node 테스트, `PC_SETUP.md`, `ROUTING_RESEARCH.md`, `TESLA_INTEGRATION.md`, `TESLA_ROAD_VALIDATION.md`, `PLEOS_STAGE4.md`, `PLEOS_VALIDATION.md` |

오래된 README/PC 안내보다 코드를 우선했다. Tesla에는 현재 `navigation_request` 단일 목적지 전송 코드가 실제로 있다. 전체 경유지 일괄 전송은 없다. OSRM도 현재 코드에는 선택적으로 연결 가능하다. 환경 변수가 실제 운영에 어떻게 설정되어 있는지는 조회하지 않았다.

### 기존 외부 검증 기록과 이번 검증의 구별

`TESLA_ROAD_VALIDATION.md`에는 과거 운영 OAuth·파트너 공개키 등록 확인과 실제 차량 목록 **0대** 응답 기록이 있다. 이는 기존 Java 배포 기록이며 Workers의 실 API 성공 증거가 아니다. 이 문서가 인용하는 기존 기록을 이번 작업에서 재검증하지 않았다. Workers Tesla 검증은 모두 Mock이다.

`PLEOS_VALIDATION.md`에는 기존 Pleos 에뮬레이터의 SDK 요청·응답 및 P→D 제한 확인 기록이 있다. 실제 도착 이벤트·실차 값은 미검증이고, 정상 운영 추천→앱 연결 실패 기록도 있다. 이번 작업에서 Android/에뮬레이터를 실행하지 않았다.

## 2. Workers 구조와 저장소

| 파일 | 역할 |
| --- | --- |
| `src/index.ts` | Hono 엔트리, `/api`와 기존 `/flowad/api` 접두사, CORS·크기 제한·메서드/미디어 타입·오류 처리 |
| `src/recommendations.ts` | Zod DTO와 기존 날씨 제외·점수·시간·풍경 다양성·EV 추정 |
| `src/routing.ts` | 경유지·독립 복귀 지점·직선 추정 및 선택적 OSRM 검증 |
| `src/tesla.ts`, `src/tesla-client.ts` | OAuth, 세션 접근 검사, 차량 목록/선택/캐시/위치, 계획/전송/사용자 확인 |
| `src/repository.ts` | D1 암호화 세션, 원자적 state 소비, 세션 lease, 요청 제한, 만료 정리 |
| `src/tickets.ts` | Java 호환 HMAC-SHA256 5분 추천 스냅샷 |
| `src/charging.ts` | 기존 가상 충전소, 실제 도로 필요 조건 유지 |
| `src/location.ts` | 선택적 D1 공개 주소 인덱스, WKB 공간 판정, EPSG:5179 Juso HTML |
| `src/types.ts`, `src/utils.ts` | strict DTO, Web Crypto AES-GCM/HMAC, fetch timeout/응답 제한 |
| `migrations/0001_auth.sql` | 세션·OAuth state·요청 제한 테이블/인덱스 |
| `address/schema.sql`, `scripts/export-address-index.py` | 공개 주소 SQLite→D1 호환 SQL의 선택적 로컬 변환 |

코스·경유지 JSON은 기존 Java resources에서 빌드 시 직접 import하여 같은 데이터를 사용한다. 실행 시 파일 접근이나 JVM은 필요하지 않다. 현재는 빌드할 때 저장소의 `backend/src/main/resources/`가 있어야 한다.

추가 파일은 모두 `workers/` 아래다. 위 소스·SQL 외에 `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `wrangler.jsonc`, `wrangler.local.jsonc`, `.gitignore`, `.dev.vars.example`, 이 문서를 추가했다. 테스트는 `test/api.test.ts`, `test/java-contract.test.ts`, `test/location.test.ts`, `test/tesla.test.ts`, `test/helpers.ts`, `test/setup.ts`, `test/fixtures/java-contracts.json`이다. 로컬 도구는 `scripts/capture-java-contracts.mjs`, `scripts/verify-ticket-parity.mjs`, `scripts/smoke-local.mjs`, `scripts/export-address-index.py`다.

### 저장소 선택

| 후보 | 판단 |
| --- | --- |
| KV | 읽기 중심 데이터에 적합하지만 전역 전파 지연과 eventual consistency가 있어 OAuth 일회성 소비·명령 중복 방지의 주 저장소로 선택하지 않음. 단순 get/delete는 원자적 소비가 아님 |
| D1 — 채택 | 조건부 UPDATE/DELETE RETURNING으로 일회성 소비와 lease 획득. 로컬 Wrangler D1로 동일 SQL 검증 가능. 무료 범위 이용 가능. 만료는 SQL 조건으로 즉시 적용하고 Cron에서 물리 삭제 |
| SQLite Durable Objects | 직렬화와 저장이 가능하고 무료 플랜에서도 사용 가능하지만 이번 요청 규모에 필수 아님. 클래스별 라우팅/수명 관리 대신 D1 조건부 변경을 선택 |

인증 판단은 D1 primary binding을 사용한다. read replication을 켜지 않는다. 브라우저별 세션 ID는 32바이트 난수이며 D1에는 ID의 SHA-256만 저장한다. 세션 내용 전체를 별도의 32바이트 Workers Secret으로 AES-256-GCM 암호화한다. 레코드 ID를 additional authenticated data로 묶는다. Access/Refresh Token, VIN, CSRF, 계획 목적지가 평문으로 저장되지 않는다. 차량 좌표 응답은 별도 저장하지 않는다.

OAuth state는 32바이트 암호학적 난수이며 세션과 결합된 해시를 5분간 저장한다. `DELETE ... WHERE hash=? AND session_id=? AND expires_at>? RETURNING`의 성공 한 번만 허용한다. 승인 거절·토큰 교환 실패 후에도 state를 재사용하지 않는다. 콜백은 설정한 HTTPS origin/path와 정확히 일치해야 한다. 로그인 성공 후 쿠키와 CSRF를 교체한다.

세션별 조건부 lease는 120초다. 인증 HTTP 호출은 각각 10초, 도로 호출은 8초 timeout이고 추천당 후보는 10개다. 동시 세션 요청은 409 `SESSION_BUSY`이며 자동 재시도하지 않는다. Refresh Token은 요청 전에 소비 상태를 저장한다. 결과가 불명확하면 재인증을 요구하여 일회성 refresh를 재사용하지 않는다.

명령은 사용자가 준비한 계획과 소유 차량을 검증하고 `replaceDestination:true`일 때만 시도한다. 외부 요청 **전에** SENDING/pending을 D1에 저장한다. 응답 유실/중단 후에도 같은 계획은 재전송하지 않으며 사용자 확인 전 새 계획을 막는다. 실제 차량 자동 확인은 구현되어 있지 않다. `NAVIGATION_CONFIRMED`도 사용자가 화면 일치를 보고한 경우이며 `automaticallyVerified:false`, `confirmationSource:USER_REPORTED`로 표시한다.

세션은 30분 만료다. Cron은 30분마다 각 테이블 최대 500건을 삭제한다. 만료 데이터는 즉시 접근 불가지만 물리 삭제와 D1 백업 보존은 다르다. 많은 만료 행이 누적되면 삭제 처리량과 저장 한도를 재검토해야 한다. 추천/주소 좌표는 로그나 추천 이력 DB에 기록하지 않는다. 명령 계획에는 암호화된 복귀 위치가 포함될 수 있다. 키 교체 시 기존 세션은 재인증이 필요하다.

## 3. 전체 API 이전 현황

표의 경로 앞에 설정한 `API_PREFIX`(`/flowad`)를 붙여도 된다. Path parameter는 없다. 모든 API는 `Cache-Control:no-store`. Tesla 쓰기 API는 HTTPS, HttpOnly Secure SameSite=Lax host-only 쿠키와 X-CSRF-Token이 필요하다. Native 티켓 검증 API는 쿠키 없이 서명을 확인한다.

| 메서드·경로 | 입력 | 기존/이전 응답·상태 | 이번 상태 |
| --- | --- | --- | --- |
| POST `/api/recommendations` | Recommendation JSON | 200 courses/제외 수/guidance; 잘못된 입력 400 error | IMPLEMENTED / LOCAL_TEST_PASSED |
| POST `/api/navigation/resolve` | `{ticket}` | 200 `{courseId,route:{points,status}}`; 오류 400 빈 body | IMPLEMENTED / LOCAL_TEST_PASSED |
| POST `/api/charging/recommendations` | `{routeStatus,geometry:[{latitude,longitude}]}` | 200 ROAD_ROUTE_REQUIRED 또는 MOCK_ONLY/stations/note | IMPLEMENTED / LOCAL_TEST_PASSED / MOCK_TEST_PASSED |
| POST `/api/location/address` | `{latitude,longitude}` | 200 `{label,type}`, 무일치 204, 좌표 오류 400 빈 body, 인덱스 미설정/오류 503 빈 body | IMPLEMENTED / LOCAL_TEST_PASSED (합성 공개 테스트 도형) |
| POST `/api/location/juso-map` | form latitude,longitude | HTML 200, 국내 좌표 오류 400, 키 미설정 503; sandbox CSP | IMPLEMENTED / LOCAL_TEST_PASSED; 공식 스크립트 실행 NOT_VERIFIED |
| GET `/api/tesla/status` | 없음 | 200 connection/locationReady/navigation/csrf/secure/message | IMPLEMENTED / LOCAL_TEST_PASSED |
| POST `/api/tesla/authorize` | query location=false, commands=false, returnTo="" 또는 check | 200 `{url}`; HTTPS/CSRF 403; 미설정 503 | IMPLEMENTED / MOCK_TEST_PASSED |
| GET `/api/tesla/callback` | query state,code,error | 성공 303 기존 프런트/tesla-check로 redirect; state 오류 400; HTTP 403 | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/disconnect` | 없음 | 204, 세션 삭제. Tesla 계정 동의 철회 API 아님 | IMPLEMENTED / LOCAL_TEST_PASSED |
| POST `/api/tesla/vehicles` | 없음 | 200 `[{id,name,state}]`, 차량 0대는 `[]` | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/select` | `{id}` | 204; 타 사용자/없는 차량 ID 400 INVALID_VEHICLE | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/reading` | 없음 | 200 Reading. 캐시 SOC/마일→km/시각·stale, NO_DATA 또는 Tesla error | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/location` | 없음 | 200 Reading LIVE, scope/online/privacy 검사; wake-up 없음 | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/navigation/preview` | `{courseId,latitude,longitude}` | 200 planId/route/stops/mode/multiStopStatus/status/expiresInSeconds; 도로 없으면 400 | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/navigation/destination/preview` | `{name,address,latitude,longitude,originLatitude,originLongitude}` | 200 위와 동일. 단일 지정 목적지 계획 | IMPLEMENTED / MOCK_TEST_PASSED; 실제 도로 NOT_VERIFIED |
| POST `/api/tesla/navigation/send` | `{planId,order,replaceDestination}` | 200 명령 결과; 만료/중복/소유권/동의 오류 400 | IMPLEMENTED / MOCK_TEST_PASSED |
| POST `/api/tesla/navigation/confirm` | `{planId,order,matched}` | 200 사용자 화면 확인 결과; 대기 명령 없으면 400 | IMPLEMENTED / MOCK_TEST_PASSED |

Recommendation DTO는 기존 latitude/longitude, availableMinutes(1~1440), scenery(all/forest/coast/open), vehicleType(ice/ev), batteryPercent, estimatedRangeKm(완충 기준), weather, courseWeather(최대 10개), originSevere, walking, departure, returnLatitude/returnLongitude를 유지한다. Weather는 condition(sunny/cloudy/rainy), temperatureC, windMps, severe, source, observedAt다. Course 응답은 id/name/reasons/estimatedRoundTripKm/estimatedMinutes/waypoints/distanceTimeStatus/batteryStatus/dataSource/route/navigationTicket다. Route는 points/legs/distanceKm/drivingSeconds/stopSeconds/totalSeconds/status/provider/generatedAt/geometryStatus/terrainStatus/warnings다. Reading은 status/batteryPercent/estimatedRangeKm/observedAt/stale/latitude/longitude/locationStatus다. 정확한 필드 정의와 조건은 `src/types.ts`, Zod schema 및 Java HTTP 응답 fixtures에 있다.

### 의도적인 계약 차이와 안전한 수정

- 기존 URL·메서드·주요 JSON·200/204/303·대표 오류는 유지했다. 타임스탬프·티켓·CSRF 난수는 계약 비교에서 제외한다. Juso HTML은 같은 좌표계·스크립트 파라미터·CSP를 유지하되 서식 및 실수의 문자열 표현은 다르다.
- `status`의 `oauthStatus`, 명령의 `commandStatus/navigationStatus/confirmationSource`는 기존 필드를 보존하는 추가 메타데이터다. 차량 목록은 배열을 유지하고 `X-Flowad-Status` 헤더로 VEHICLE_LIST_SUCCESS/NO_ACCESSIBLE_VEHICLES를 구분한다.
- CORS Origin 명시 허용, 2MB 요청 한도, IP 해시 기준 분당 120회·세션 기준 분당 20회 제한을 추가했다. 따라서 기존에 없던 403 ORIGIN_NOT_ALLOWED, 413 REQUEST_TOO_LARGE, 429 RATE_LIMIT, 동시 요청의 409 SESSION_BUSY가 가능하다. 429/409를 차량 명령 자동 재전송 근거로 사용하지 않는다.
- 405/415 상태를 유지하지만 Spring 기본 에러의 timestamp/path/error envelope 전체는 복제하지 않고 `{error:...}`로 통일한다. 기존 Charging의 잘못된 geometry에 대한 처리되지 않은 500은 안전하게 400 INVALID_REQUEST로 바꿨다.
- callback URI 검증, 갱신 후 명령 scope 재확인, 선택 차량의 own-property 확인, 미확인 명령 중 차량 목록/선택 변경 차단을 강화했다. 세션은 JVM 메모리에서 암호화 D1으로 바뀐다.
- Java의 시작 시 무작위 티켓 secret 기본값은 isolate마다 달라질 수 있어 제거했다. Workers에서는 지속적인 NAVIGATION_TICKET_SECRET이 필요하다. 로컬 구성만 공개 테스트 키를 사용한다.
- OSRM timeout은 Java 90초에서 8초로 줄였다. 오류 시 추정 경로로 대체하지 않는다. geometry 최대 20,000점/leg, 응답 4MB 제한으로 큰 응답은 거절한다. 주소 조회는 100개 후보·도형당 50,000점 제한을 넘으면 성공을 가장하지 않는다.
- `/` 및 정적 파일 제공은 Java에서 유지된다. Workers는 API만 제공하므로 `/`는 404다. Pages 연결·기존 Render 프록시 변경은 다음 단계이며 이번 작업에서 수정하지 않았다.

## 4. 기능 상태·Pleos 분류

| 기능 | 코드 이전 | 이번 검증 | 범위/미이전 이유 |
| --- | --- | --- | --- |
| 추천/왕복/경유지/날씨 점수 | IMPLEMENTED | LOCAL_TEST_PASSED | 기본은 직선×1.18, 55km/h 추정. 실제 전체 도로가 아님 |
| 선택적 OSRM | IMPLEMENTED | MOCK_TEST_PASSED | HTTPS 설정 시에만 사용. 이번 실제 도로 API 응답 NOT_VERIFIED |
| EV 판단/가상 충전소 | IMPLEMENTED | MOCK_TEST_PASSED | 실제 도로 없는 EV는 ROAD_ROUTE_REQUIRED. 충전소는 실존하지 않는 가상 데이터 |
| Tesla OAuth/갱신/차량/배터리/위치 | IMPLEMENTED | MOCK_TEST_PASSED | Workers 실제 OAuth/API는 NOT_VERIFIED |
| Tesla 단일 목적지 계획/전송/사용자 확인 | IMPLEMENTED | MOCK_TEST_PASSED | 실제 명령·화면 NOT_VERIFIED. 다중 목적지 미지원 유지 |
| Tesla 파트너 자동 등록 | 이전 제외 | NOT_VERIFIED | HTTP Controller가 아닌 Java ApplicationRunner의 명시적 운영 작업. Workers 요청·시작 시 등록을 자동 실행하지 않음. 기존 공개키/등록 도메인 그대로 보존 |
| 주소 인덱스 | IMPLEMENTED | LOCAL_TEST_PASSED | 공개 테스트 도형의 D1 조회만 검증. 전국 SQLite 실데이터 변환·크기/성능은 NOT_VERIFIED |
| A. Pleos 서버 HTTP | IMPLEMENTED | LOCAL_TEST_PASSED | 공통 추천 + HMAC 추천 티켓 검증. 별도 Pleos REST provider는 원래 없음 |
| B. Android 네이티브 SDK | 이전 대상 아님 | NOT_VERIFIED | `PleosNavi` NaviHelper, `PleosVehicleAdapter` Vehicle, CarUxRestrictions, WebView 브리지/여정 복원은 Android에 그대로 유지 |
| C. Emulator/Virtual Console | 이전 대상 아님 | NOT_VERIFIED | Android 기기 테스트·주입된 도착 이벤트. Workers에서 에뮬레이션하지 않음 |
| D. Mock/미구현 | 유지 | MOCK_TEST_PASSED / NOT_VERIFIED | FakeNavigationGateway·가상 충전소는 Mock. 실차 SOC/잔여거리/도착·충전소 제공자는 이번 완료 대상이 아님 |

공식 Tesla 문서에서 authorize/token 도메인, scope와 단일 사용 refresh 요구를 확인했다. 차량 명령 프록시가 일반 명령의 서명을 담당한다는 조건을 보존했다. 기존 코드와 같은 `navigation_request`만 허용하고, GPS/waypoints 등 확인되지 않은 본문은 만들지 않았다. 필요 시 TESLA_COMMAND_PROXY_URL의 HTTPS origin을 사용한다. 실제 계정/지역/차종/가상키/과금·명령 동작은 이번 작업에서 확인하지 않았다.

## 5. 실행한 검증

아래는 모두 로컬 결과다. 테스트의 fetch는 기본적으로 실패하도록 차단하고 각 테스트의 Mock만 허용한다. 실제 외부 차량/도로 호출은 없다.

| 검사 | 명령/방법 | 실제 결과 |
| --- | --- | --- |
| 기존 Java 회귀 | 저장소 루트 `mvn -f backend/pom.xml test` | LOCAL_TEST_PASSED, 50 tests, 실패/오류/skip 0 |
| 타입 검사 | workers에서 `npm run typecheck` | LOCAL_TEST_PASSED |
| Lint | `npm run lint` | LOCAL_TEST_PASSED |
| Workers Vitest | `npm test` | LOCAL_TEST_PASSED / MOCK_TEST_PASSED, 4 files · 78 tests. Java 응답 계약 비교 27건 포함 |
| Java 계약 fixtures | 변경하지 않은 로컬 Java 실행 후 `node scripts/capture-java-contracts.mjs` | 27 HTTP 응답 캡처. 8개 추천 조건, 잘못된 입력, 충전, 주소, 티켓, Tesla 상태/가드 비교 |
| HMAC 양방향 | 두 로컬 서버에서 `node scripts/verify-ticket-parity.mjs` | LOCAL_TEST_PASSED, Java→Workers와 Workers→Java 모두 실제 검증 성공 |
| D1 migration | `npm run db:local` | LOCAL_TEST_PASSED, 0001_auth.sql의 8 SQL 명령 적용 |
| 로컬 HTTP | Wrangler loopback 18787 + `npm run test:smoke` | LOCAL_TEST_PASSED, 17 checks. 최종 10개 반복 추천 HTTP 왕복 중앙값 10.5ms, 최대 127.6ms (첫 실행 13.1/13.3ms). CPU 계측 아님 |
| 빌드 | `npm run build` (`wrangler deploy --dry-run`) | BUILD_PASSED. 네트워크 배포 없음. 약 1,154KiB / gzip 214KiB |
| 의존성 | `npm audit` | 0 vulnerabilities. 개발 도구의 minimatch 취약 버전은 typescript-estree 하위 override로 갱신하고 Lint 재확인 |
| 주소 exporter | 합성 공개 SQLite → SQL export → 별도 SQLite 재import | LOCAL_TEST_PASSED, 이름의 따옴표 escaping·BLOB·bounds 보존. 실제 전국 데이터는 NOT_VERIFIED |
| CPU 10ms/메모리·실제 부하 | 운영 quota 계측 없음 | NOT_VERIFIED. 로컬 HTTP 왕복 시간은 CPU 시간이 아님 |

테스트는 추천/반환 위치/날씨/다양성 계약, 잘못된 요청/메서드/타입/CORS/크기, OSRM 응답·실패, 충전 Mock, WKB/주소/Juso, OAuth state 원자 소비·다른 세션·만료·재사용, 쿠키/CSRF/HTTPS, D1 암호화·만료, 차량 0대/불투명 ID/소유권, refresh 단일 사용, Tesla HTTP 오류·timeout·location privacy, 명령 동의/중복/불명/중단 복구/사용자 확인을 포함한다.

## 6. 무료 플랜 평가

2026-11-12 공식 문서 확인 기준: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)의 Free는 일 100,000 요청, HTTP CPU 10ms, isolate 메모리 128MB, 요청당 외부 subrequest 50개, 동시 외부 연결 6개다. I/O 대기는 CPU 시간에 포함되지 않는다. 한도 초과로 플랫폼이 반환하는 1102/일일 한도 오류는 애플리케이션 내부에서 항상 JSON으로 변환할 수 없다.

[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)과 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)의 Free는 하루 읽기 500만 행·쓰기 10만 행, 계정 총 5GB·DB당 500MB, 호출당 50 query다. 세션 lease·quota·인덱스·정리는 추가 쓰기를 소비하므로 **Workers 일 10만 요청을 이 앱에서 전부 무료로 처리한다고 보장하지 않는다.** D1 한도/장애는 503으로 닫고 명령을 자동 재시도하지 않는다. 큰 주소 데이터는 저장·조회·CPU 한도에 걸릴 수 있다.

코스 후보는 10개, 도로 fetch는 순차 최대 10개이며 큰 응답/입력을 제한한다. 웹 폴링·차량 wake-up·상시 스레드·자동 API 재시도·장기 백그라운드 작업은 없다. 저장소 구성은 무료 D1으로 가능하며 유료 서비스 활성화는 필요하지 않다. 다만 OAuth 암호화/큰 OSRM JSON/최대 충전 geometry/주소 공간 계산의 CPU 10ms 적합성은 **NOT_VERIFIED**다. 로컬 통과만으로 무료 운영 확정 또는 콜드 스타트가 전혀 없다고 주장하지 않는다.

저장소 검토 출처: [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Tesla 출처: [Third-party tokens](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens), [Vehicle commands](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands). 공식 문서 내용도 차후 작업 시작 시 재확인한다.

## 7. 로컬 재현

```powershell
cd C:\Users\user\Documents\ChatGPT\flowad\workers
npm ci
npm run db:local
npm run typecheck
npm run lint
npm test
npm run build
npm run dev -- --ip 127.0.0.1 --port 18787 --inspector-port 19229
```

다른 터미널에서 같은 workers 디렉터리의 `npm run test:smoke`. 기본 `npm run dev` 포트는 8787이며 스모크 스크립트는 검증용 18787을 사용한다. 로컬 `/`는 페이지를 제공하지 않는다. HTTP에서는 추천·티켓·충전·주소 fallback이 동작하고 Tesla 작업은 HTTPS_REQUIRED로 막힌다. OAuth 성공 경로는 HTTPS URL을 사용하는 workerd Mock 테스트로만 확인한다.

`wrangler.local.jsonc`의 두 키는 공개 테스트 값이며 실제 Secret이 아니다. 실제 `.dev.vars`는 만들거나 변경하지 않았다. 로컬 검증 디렉터리에 실제 Tesla 자격 증명을 넣지 않는다. 로컬 구성은 Terraform/DNS/원격 DB에 접근하지 않는다.

Java 계약을 다시 생성할 때는 backend 디렉터리에서 다음 명령으로 외부 연결을 명시적으로 끈다. `NAVIGATION_TICKET_SECRET` 값은 로컬 공개 테스트 키다.

```powershell
mvn spring-boot:run "-Dspring-boot.run.arguments=--server.port=18081 --server.address=127.0.0.1 --ROAD_ROUTING_URL= --ADDRESS_INDEX_PATH= --TESLA_REGISTER_PARTNER=false --TESLA_CLIENT_ID= --TESLA_CLIENT_SECRET= --TESLA_REDIRECT_URI= --JUSO_MAP_API_KEY= --NAVIGATION_TICKET_SECRET=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="
```

이후 workers에서 `node scripts/capture-java-contracts.mjs`, `node scripts/verify-ticket-parity.mjs`. 캡처 스크립트는 loopback 18081만 호출하고 공개 서울/부산/강릉 테스트 좌표만 사용한다. 정상 테스트 실행에는 Java 서버가 필요하지 않으며 버전 관리된 fixtures를 쓴다.

## 8. 2단계에 필요한 결정·설정 목록 (이번에는 실행하지 않음)

| 기존 설정 / 추가 설정 | Workers 대응 |
| --- | --- |
| TESLA_CLIENT_ID, TESLA_CLIENT_SECRET | 이름 유지, 운영에서는 Workers Secrets |
| TESLA_REDIRECT_URI | 이름 유지, 정확한 등록 HTTPS URL을 일반 vars로 지정 |
| TESLA_COMMAND_PROXY_URL, ROAD_ROUTING_URL | 이름 유지, 선택적 HTTPS 제공자 URL |
| NAVIGATION_TICKET_SECRET | 이름 유지, base64 HMAC 키, 운영 Secrets |
| JUSO_MAP_API_KEY | 이름 유지, 운영 Secrets로 관리하되 최종 HTML에는 기존처럼 브라우저 승인키 포함 |
| ADDRESS_INDEX_PATH | 파일 경로 사용 제거. 선택적 ADDRESS_DB D1 binding과 공개 데이터 import로 대체 |
| TESLA_REGISTER_PARTNER | Workers 자동 등록 설정 없음. 기존 Java 운영자 도구 보존 |
| PORT, APP_CONTEXT_PATH, server.servlet.session 설정 | PORT는 로컬 Wrangler CLI, context path는 API_PREFIX, 세션은 D1 TTL+쿠키로 대체 |
| SERVER_SSL_KEY_STORE/TYPE/PASSWORD | Workers 런타임에서는 사용하지 않음. 이번 단계에서는 TLS/인증서 변경 없음 |
| TOKEN_ENCRYPTION_KEY | 신규 32바이트 base64 AES 키, 운영 Workers Secret |
| ALLOWED_ORIGINS, FRONTEND_URL, API_PREFIX | 신규 일반 vars. 명시적인 origin 목록, 안전한 callback 복귀 URL, 기존 경로 보존 |
| DB, 선택적 ADDRESS_DB | D1 binding. 로컬 데이터베이스와 운영 ID를 분리 |

1. Cloudflare 계정과 **새 D1 database_id**를 실제 생성 결과로 지정. `wrangler.jsonc`에는 임의 계정/DB ID나 route를 넣지 않았다. 원격 migration/Secret 등록/배포는 아직 실행할 수 있는 설정이 모두 채워진 상태가 아니다.
2. 실제 서비스 경로 확정. 현재 코드/Android는 `https://ravirgo.com/flowad/`이므로 해당 계약을 우선 보존했다. Pages 같은 origin의 `/flowad/api/*` 연결 또는 별도 API 도메인을 결정한 후 CORS·쿠키·Juso iframe CSP·콜백을 함께 검토해야 한다. 프런트 API 경로나 기존 Render 프록시는 수정하지 않았다.
3. 독립적인 32바이트 base64 TOKEN_ENCRYPTION_KEY, 최소 32바이트 NAVIGATION_TICKET_SECRET을 Workers Secrets에 설정. TESLA_CLIENT_ID/SECRET도 Secrets. 기존 Java 티켓과 단기간 호환하려면 기존 키의 안전한 이관 여부를 결정한다. 값은 채팅/소스/로그에 남기지 않는다.
4. TESLA_REDIRECT_URI는 등록된 정확한 HTTPS URL. FRONTEND_URL, API_PREFIX, ALLOWED_ORIGINS는 일반 vars. ROAD_ROUTING_URL과 TESLA_COMMAND_PROXY_URL은 실제 승인된 HTTPS 주소를 설정할 때만 활성화. JUSO_MAP_API_KEY는 브라우저 스크립트에서 사용되는 제공자 승인키이며 사용자에게 노출되는 기존 특성을 이해하고 도메인 제한을 확인한다.
5. 주소 기능이 필요하면 공개 지역 데이터만 선택적 ADDRESS_DB로 이관. 로컬 exporter/스키마는 준비했지만 전국 실데이터 크기·공간 조회 비용·D1 SQL 100KB 제한·ODbL 조건 검토가 남아 있다. 기본 미설정 503은 기존 동작과 같다.
6. Tesla 공개키의 기존 루트 URL `https://ravirgo.com/.well-known/appspecific/com.tesla.3p.public-key.pem`과 기존 등록 도메인을 유지. 별도 도메인으로 옮기면 공개키·앱 설정·등록 요구를 재검토한다. 서버 시작 때 파트너 등록을 자동 실행하지 않는다.
7. TLS/브라우저 쿠키/원격 D1 consistency/삭제·백업 보존/로그에서 OAuth query 제거/계정별 외부 API 한도 검토. idempotency는 브라우저 세션·계획 단위이며 다른 브라우저·세션 만료 후 차량 전역 중복은 방지하지 않는다.
8. 운영 CPU·메모리·D1 사용량 측정, 특히 큰 geometry/주소 인덱스. 무료 CPU 적합성은 다음 단계 검증 조건이며 현재 미확정이다.

**판정:** 1단계 소스 구현과 로컬 검증을 제공한다. 2단계 준비·검토는 가능하지만 실제 배포/무료 운영/실차 연결 완료를 뜻하지 않는다. 2~4단계 작업은 시작하지 않았다.
