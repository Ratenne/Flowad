# Flowad — Codex 작업 지침

이 파일은 Codex가 코드 수정, 리팩터링, 테스트 및 문서 변경을 시작하기 전에 확인할 프로젝트 컨텍스트다.

## 작업 시작 전

1. 사용자 요청과 현재 소스코드 및 관련 문서를 먼저 확인한다. 아래 보존된 README는 작성 당시의 개발 기록이며 현재 구현 상태와 다를 수 있다. 실제 동작 및 최근 변경 사항은 코드로 검증한다.
2. 변경 대상에 따라 `PC_SETUP.md`, `ROUTING_RESEARCH.md`, `TESLA_INTEGRATION.md`를 확인한다.
3. 프런트엔드(`dist/`), Spring Boot 백엔드(`backend/`), Pleos Android(`pleos-android/`), Cloudflare(`cloudflare/`)의 책임을 구분한다.
4. 실제 도로 경로·충전소·실차 제어·Tesla/Pleos API 실연동을 검증 없이 구현 완료로 설명하지 않는다. 목 응답, 예상값, 외부 서비스의 실측/실응답을 명확히 구분한다.
5. 사용자 위치와 차량 인증 정보 등 민감한 데이터가 로그·소스·커밋에 유출되지 않도록 한다. 비밀키와 인증 토큰은 환경 변수 등 적절한 보안 저장소에서 관리한다.
6. 작업과 연관된 테스트를 실행하고 실행 여부·결과·미검증 사항을 정확히 보고한다.
7. `README.md`는 서비스 개요를 위한 문서로 유지하며, 자세한 개발 이력·구현 지침은 이 파일 또는 관련 기술 문서에 기록한다.

## 이전 README 원문 (분리 보존)

아래 내용은 README 분리 시점의 원문이다. 추후 작업 시 참고 자료로 활용하되, 최신 구현과 충돌하면 코드를 우선 확인한다.

---

# 결론 (결 + 로드)

A location-first Korean drive discovery MVP. The visitor supplies a starting location, never a destination. The app selects courses automatically from a small editorial seed catalog.

## 1단계: 공통 추천 API (로컬 개발)

기존 `dist/`는 그대로 유지하고 Spring Boot가 로컬에서 정적 화면과 API를 같은 출처로 제공합니다. 기존 정적 사이트 호스팅은 Java 서버를 실행하지 않습니다. 정적 호스팅만 사용할 경우 API 오류가 표시됩니다. 실제 배포 및 인증, HTTPS, 서버 보안 설정은 이 단계의 범위 밖입니다.

필수 환경: JDK 17, Maven 3.6.3 이상, 최초 의존성 다운로드를 위한 인터넷 연결. 현재 개발 환경 JDK 17을 사용하며 Spring Boot 3.5.7을 선택했습니다. JDK 17 업데이트와 Spring Boot 패치 수준은 운영 적용 전에 다시 확인하세요.

```powershell
cd gyeollon/backend
mvn spring-boot:run
```

브라우저에서 `http://localhost:8080/`을 열고 현재 위치를 허용하거나 서울 체험/출발 지역을 선택합니다. 종료는 실행 터미널에서 Ctrl+C입니다. 위치 권한에는 localhost 또는 HTTPS가 필요합니다.

```powershell
cd gyeollon/backend
mvn test
cd ..
node scripts/test-engine.mjs
node scripts/test-terrain.mjs
```

`POST /api/recommendations` 예시 (좌표는 서울 시청 예시):

```json
{"latitude":37.5665,"longitude":126.978,"availableMinutes":180,"scenery":"forest","vehicleType":"ev","batteryPercent":70,"estimatedRangeKm":400,"walking":true,"weather":{"condition":"sunny","temperatureC":22,"windMps":2,"severe":false,"source":"user input","observedAt":null}}
```

`scenery`: `all`, `forest`, `coast`, `open`; `vehicleType`: `ice`, `ev`. `estimatedRangeKm`은 기존 화면과 같은 **완충 시 예상 주행거리**입니다. 배터리나 완충 주행거리가 없으면 `INSUFFICIENT_INPUT`입니다. `courseWeather`는 코스 ID별 날씨 객체이며 미제공 시 `weather`를 사용합니다. `observedAt`은 ISO-8601 시각 또는 null이며 예보의 경우 관측이 아닌 예보 대상 시각입니다. 날씨가 없을 때는 예시 조건을 사용합니다. `departure`는 기존 화면의 `now`, `morning`, `afternoon`, `sunset`, `walking`은 산책 포함 여부입니다. 추천 응답의 `ESTIMATED_NOT_ROAD_ROUTED`는 전체 실제 도로 경로가 없다는 의미입니다. 코스 경유 지점은 이름과 설명만 제공하며 정확한 내비게이션 좌표가 아닙니다. 점수는 기존 조건·기상 제외·다양성 규칙을 기준으로 산출합니다.

서버는 요청의 위치·차량 입력을 계산 중 메모리에서만 사용하며 DB, 파일, 애플리케이션 로그에 저장하지 않습니다. 브라우저는 코스 ID만 localStorage에 사용자가 삭제하거나 사이트 데이터를 지울 때까지 보관합니다. 기존 Open-Meteo 요청은 출발 좌표를 소수점 둘째 자리로 반올림해 외부로 보냅니다. 예보 공급자의 보관 정책과 상용 이용 조건은 별도 확인해야 합니다. 사용자 입력 날씨와 예시 날씨는 실측이 아닙니다.

전체 왕복 도로 탐색, 실시간 교통, 검증된 충전소, Tesla Fleet API 및 Pleos SDK 연동은 없습니다. 충전 시간은 왕복 시간에 포함되지 않습니다. 향후 차량 연동과 실제 제공자 선택 시 각 플랫폼 계정, 앱 등록, 권한, 이용 조건과 요금 확인이 필요하며 아직 특정 제공자나 권한 범위를 확정하지 않았습니다.

## 기존 정적 화면 (API 연결 전 설명)

## Run

Buildless static site: serve `dist/` over HTTP(S). Location permission requires HTTPS (or localhost). No build or API key is required. `node scripts/test-engine.mjs` runs the core deterministic checks.

## Implemented

- Explicit browser geolocation, with clear loading, denied, timeout and unsupported states. Coordinates remain in session memory; they are not stored.
- Optional departure-city fallback and an explicitly labeled Seoul sample mode. No silent location inference.
- Coordinate-based candidate search across the entire catalog: Haversine approach distance, road factor 1.18, local course allowance, average 55 km/h, walk and rest budget. This is a proximity estimate, not navigable road routing.
- Open-Meteo hourly forecasts for the rounded origin and 10 seed-course coordinates, requested in one batch. Candidate weather is selected around estimated arrival time, with KST scheduling. Weather fetches are abortable and stale results cannot override new locations or manual weather settings.
- Weather, scenery, preference, convenience and novelty scoring; severe weather flags / exposed high-wind courses / high-altitude rainy courses are excluded before ranking. Diversity penalizes repeat scenery among the final three.
- EV range / battery / reserve estimates and indicative charging need, without claiming a verified compatible charging station. Charging time is not included in the travel-time estimate, clearly stated in details.
- Browser-local bookmarks, course details, contextual map links, responsive layouts, keyboard controls, reduced-motion handling.
- Vendored Three.js r170 renders per-course georeferenced surface terrain, actual OSRM/OSM road polylines, moving car, named area labels and orbit interaction. A CPU Canvas compatibility path uses the same data, elevation sampler, projection and path model.

## Scope and limitations

The 10 courses cover the Seoul metropolitan, Gangneung and Busan areas. Regions without reachable seed courses show an empty result. Roads, access, distance, traffic, parking, opening hours and charger availability have not been verified. The 3D relief now uses actual Copernicus GLO-90 surface elevations around each course highlight segment, with 2× vertical exaggeration. It is not a full current-location round-trip road model. Course distances, timing and EV consumption are estimates. The product displays these limitations.

Weather source: [Open-Meteo](https://open-meteo.com/). If the API is unavailable, fallback data is explicitly labeled; manually changing weather switches to simulation mode. Forecast data is not a safety guarantee. Production/commercial use requires reviewing the provider's applicable terms.

## Validation

- Node syntax checks for application and engine modules.
- Pure-engine tests for geographic distances, origin-dependent timing and return itinerary, KST next-departure rollover, nearest-hour forecast selection and severe-weather flags.
- Stubbed geolocation success / permission-denied callbacks; no tester's actual location was requested.
- Browser QA: location-less initial screen, manual Seoul / Busan origin changes, live forecast response, hot / high-wind ranking, EV low-battery details, bookmark persistence, detail dialog, 390px layout, interactive compatibility terrain and course tour.
- QA browser has WebGL disabled; GPU output could not be visually verified. The tested CPU compatibility renderer remains interactive.

Third-party license: `dist/assets/THREE-LICENSE.txt` (Three.js, MIT). The site optionally loads Noto Sans KR via Google Fonts and has system-font fallbacks.

## In-car UI revision (2026-10-28)

- Fixed landscape cockpit: persistent app rail, location/status bar, route list, 3D terrain and bottom primary action. Head-unit controls are sized generously; main icon buttons and steppers are at least 76 CSS pixels in height. This is not a statement of platform dp compliance or certification.
- At 1280×720, recommendation results prioritize the three routes; trip duration moves to the parked settings sheet. Portrait widths retain a responsive companion view.
- Parked sheets separate trip, vehicle and weather settings. Battery, temperature and wind use large increment/decrement controls instead of small sliders.
- Drive-view preview presents only the selected course, estimated trip time/distance and rest stop. It closes sheets, pauses the animated car, makes the app rail inert, removes terrain keyboard focus and suppresses direct terrain interactions. Returning to the parked view restores controls.
- No vehicle driving-state integration is present. The mode toggle is a manual UI demonstration, never a sensor-based safety interlock. No Android Auto / Automotive OS / CarPlay native integration or platform certification is claimed.
- Existing location-first ranking, forecast integration, local bookmarks and coarse range estimates remain.

Revision QA: browser flows for demo recommendation, trip/vehicle/weather tabs, battery and weather steppers, route selection, details, bookmark toggle, drive-view entry/exit, manual Busan origin selection, 1280×720 and 390px layouts. The QA browser lacks WebGL; the Three.js CPU compatibility path was visually inspected. Pure-engine checks still pass.

## Actual course terrain (2026-10-29)

The prior scene-type terrain generator has been removed. Each of the 10 courses now has its own captured geographic bounds, 129×129 elevation grid, OSM road geometry and snapped area anchors in `dist/terrain/`.

- Source: Copernicus DEM GLO-90, 2021 release distributed as public COGs on AWS. It is a surface model (DSM), including possible vegetation/infrastructure contributions, not a new ground survey. The original nominal resolution is 90m; displayed grids are resampled and do not imply extra measurement detail.
- Roads: public OSRM routing on OpenStreetMap between explicit, approximate named area anchors. The source geometry is preserved as a polyline rather than reshaped with a spline. These are highlight segments, not guaranteed entrances, parking locations or an entire origin round trip.
- Meshes: a shared georeferenced sampler feeds WebGL and compatibility rendering. The horizontal projection is Web Mercator, vertical units account for latitude scale, and vertical exaggeration stays fixed at 2× across courses. Heights at/below sea level are flattened for presentation. No fabricated trees, houses, river or hill presets are shown. Inland water/land-cover boundaries are not mapped by this renderer.
- Data fetching: course assets are local to the Site and cache by course ID; no visitor coordinates are sent to a terrain or road provider. A latest-selection token prevents old responses from drawing after a new choice. During a course change, stale terrain is hidden. Failure shows a clear empty/error state with reset-to-retry, never generated substitute terrain.
- UI: geographic anchor labels, highlight distance, terrain elevation range, 2× exaggeration and the original resolution are shown. Sources and full notices are in Service Info.

Reproduce assets with `python scripts/build-terrain.py` (Python, NumPy, Pillow; public HTTP access needed). Raw source files cache outside the repository. Run `node scripts/test-terrain.mjs` for all 10 unique height grids, geographic road bounds/snapping, mesh/road height alignment, bilinear sampling, invalid-data rejection, cache reuse, selection races and retry. Existing engine checks remain unchanged.

Browser QA verified distinct Yangpyeong, Paju, Siheung and Daegwallyeong models, source/elevation labels, route switching and tour/parked-preview interaction. WebGL is disabled in the QA browser; the shared-data compatibility renderer was visually verified.

Sources:
- https://registry.opendata.aws/copernicus-dem/
- https://copernicus-dem-90m.s3.amazonaws.com/readme.html
- https://www.openstreetmap.org/copyright
- https://project-osrm.org/docs/v5.24.0/api/

Data attribution: produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM™-90. No official endorsement is implied. Road data: © OpenStreetMap contributors, ODbL. Modifications: bilinear resampling, geographic clipping, terrain mesh construction, height exaggeration and presentation-level sea flattening.

## 2단계 경로 모델

[제공자 조사와 공통 경로 계약](ROUTING_RESEARCH.md)을 참조하세요. 현재 외부 도로 제공자는 연결되지 않았으며 화면과 API의 왕복 거리·시간은 목 추정입니다. 3D 화면은 전체 왕복이 아닌 기존 하이라이트 구간입니다. 실행·테스트 방법은 위와 같습니다.

## Tesla 3단계 진행 상태

Tesla OAuth와 차량 조회는 목 테스트했으며 실제 Tesla API 검증은 미완료입니다. 내비 명령은 미지원 상태입니다. [공식 문서 조사와 남은 작업](TESLA_INTEGRATION.md)을 확인하세요.

## PC 실행 및 5단계 진행 상태

[PC 실행, 계정·에뮬레이터 설정과 현재 검증 범위](PC_SETUP.md)를 확인하세요. 실제 Tesla·도로 API와 Pleos 에뮬레이터는 아직 응답을 검증하지 않았습니다.

## 차량 순정 내비 우선

타사 지도 길찾기 API 연결은 제거했습니다. 현재 서버의 왕복은 추정이며, Pleos 순정 내비 요청·Tesla 지원 범위와 결과는 아직 검증되지 않았습니다. 자세한 내용은 [PC 설정](PC_SETUP.md)을 확인하세요.
