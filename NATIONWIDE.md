# 전국 동적 코스 시스템

## 구조와 계약

OSM 대한민국 PBF → 오프라인 SQLite 정규화·접근 후보·중복 표시 → 불변 스냅샷과 공개 gzip → D1 공간 셀·RTree → 후보 POI 최대 20개 → 로컬 추정 이동행렬 → 폭 14의 Beam Search(경유지 1~3개) → MMR → 최대 5개 동적 추천. 사용자가 선택한 코스의 도로 확인 → OSRM Route 검증 → 실제 도로선·3D·명시적 차량 전송 준비.

`POST /api/recommendations`는 기존 입력을 유지하고 `requestId`, `originSource`, `roundTrip`(기본 true), 북마크 재계산용 `poiIds`를 받는다. 기본 추천에는 외부 도로 요청이 없다. 거리(직선거리 × 1.3)·주행시간(45km/h 가정)은 `ESTIMATED_NOT_ROAD_ROUTED`로 표시하며 정차·산책 시간을 따로 더한다. 이 상수는 실측 도로·교통 정보가 아니다. 도로 geometry는 null, `vehicleTransferAllowed=false`이며 접근 가능성을 보장하지 않는다. 반환 코스는 `dyn-` ID, 경유지·접근 후보, 점수·출처·서명 티켓을 포함한다. ID는 공개 POI 순서와 왕복 여부로 결정하며 개인 출발 좌표는 ID나 서버 저장소에 남기지 않는다. 같은 POI 코스도 현재 출발지에서 다시 계산한다.

`POST /api/navigation/verify`는 사용자가 선택한 서명 티켓의 좌표·순서만 OSRM Route로 검증한다. 성공 시 `ROAD_ROUTED`, 도로 geometry, 실제 도로 거리·예상시간 및 새 티켓을 반환한다. 브라우저는 해당 카드·3D를 갱신하고 Tesla/Pleos에는 검증된 티켓만 명시적 동작으로 전달한다. 실패 시 기존 추천과 출발지는 유지하며 전송을 허용하지 않는다. 추천 재조회는 기존 유효 기기 위치를 재사용하고 위치 다시 측정 동작은 별도로 유지한다.

추천 HTTP 경로에는 `courses.js`/고정 anchors 조회가 없다. 과거 서명 티켓과 과거 지형 파일의 읽기 호환만 남긴다. 이전 북마크 ID는 보관 개수를 안내하고 실제 동적 코스로 위장하지 않는다. 새 북마크에는 공개 POI 정보만 저장하고 사용자 출발지·전체 경로·인증 정보·티켓을 저장하지 않는다.

점수는 풍경 35%, 시간 25%, 명소 20%, 효율 20%다. 공개 태그와 품질에 기반한 추정이며 경관 실측이 아니다. 날씨 위험, 차량 배터리 입력, 산책·정차 시간, 편도·왕복을 반영한다. 기본 정차는 지점당 10분, 산책 포함 시 추가 10분이다. 동일 POI 조합을 제거하고 POI 중복과 방향 유사도로 다양성을 확보한다. 후보가 적거나 도로가 실패하면 3개를 강제로 채우지 않는다.

## 실제 데이터와 제한

2026-11-17 추가 검증: GitHub의 격리 Linux 환경에서 전국 OSRM MLD 그래프를 새로 구축하고 로컬 Worker/D1과 연결했다. 서울·부산·대구·제주·저밀도 출발은 각각 5개, 강원 출발은 4개의 검증된 코스를 반환했다. 강원의 실패 후보를 가짜 코스로 채우지 않았다. 요청당 Table 1회·Route 최대 5회, 공간 검색 3회(행/셀 SQL 각 1개씩)였으며 전체 HTTP 검증 시간은 지역별 117~394ms였다. 이는 운영 네트워크·콜드스타트·Worker CPU 측정이 아니다. [실행 로그](https://github.com/Ratenne/Flowad/actions/runs/43985773319)를 참조한다. 원본 요약 `validation/nationwide-isolated.json`은 로컬 검증 산출물로 Git에서 제외한다.

통합 코드의 Workers 테스트 148개와 Java 52개, POI 파이프라인 5개가 통과했다. 공개 DEM 221개 전체의 129×129 유한 고도값과 실제 서울 경로의 타일 로딩도 확인했다. 화면 QA의 도로 응답은 별도 로컬 Mock이며 실제 도로 검증 결과와 구분한다. 코스 비교·북마크 복원·지형 표시를 확인했고, 실차 명령·실제 모바일 GPS 측정·운영 추천 API 테스트는 하지 않았다. Android/Pleos는 통합된 기존 변경을 보존했으며 이 Windows 작업에서 새 실차 검증을 했다는 의미가 아니다.

Cloudflare Worker에 `TOUR_API_KEY`가 등록된 것은 확인했으나 서버 Secret 값은 오프라인 수집기로 읽어오지 않는다. 로컬 수집 환경에는 키가 없어 TourAPI 실제 수집은 여전히 미완료다. 동일 키를 수집 작업의 환경 변수로 안전하게 제공한 뒤 위 수집·검증·적재 절차를 실행해야 한다.

2026-11-16 Geofabrik 대한민국 전체 추출물 291,897,143바이트를 처리했다. 원본 SHA256 기반 스냅샷 `osm-d3dcc6478ee3dfc989895621`, 배포 스냅샷 `osm-d3dcc6478ee3dfc989895621-cells-v1`이다.

- 유효한 이름·국내 좌표를 가진 POI **42,085건**, 중복 후보 표시 485건.
- 자동차 접근 후보 POSSIBLE_ACCESS 28,130건, UNVERIFIED_ACCESS 13,944건, NO_CAR_ACCESS 11건. 현장 검증된 접근·주차로 주장하지 않는다.
- 유형: attraction 1,241; beach 364; nature_reserve 36; park 9,816; peak 16,399; picnic_site 284; viewpoint 1,217; water 12,512; waterfall 216.
- TourAPI: **BLOCKED_MISSING_CREDENTIAL / TOUR_API_KEY**. 수집·페이지 재시도·상세정보·적재·갱신은 구현했고 실제 인증 호출은 하지 않았다. 샘플을 전국 TourAPI 데이터로 보고하지 않는다.
- 원본 geometry와 태그는 오프라인 SQLite에 보관한다. 운영에는 제한된 허용 속성·원본 레코드 해시·대표 좌표·도로/주차 후보를 내보낸다.

지역은 해당 추출물의 OSM admin_level=4에 따른다. 강원 2,832; 경기 5,571; 경남 5,504; 경북 6,469; 대구 1,121; 대전 492; 부산 805; 서울 1,860; 세종 208; 울산 774; 인천 1,012; 전남광주통합특별시 6,359; 전북 3,566; 제주 739; 충남 2,555; 충북 2,218. 이는 OSM 분류이며 별도 행정구역 공인 통계가 아니다.

## 저장·비용·개인정보

마이그레이션 0002~0004는 POI 전용 테이블·세대 포인터·작업 상태·전역 도로 작업 슬롯을 추가한다. 기존 Tesla 세션 테이블을 수정하지 않는다. 정규화 행 저장과 공간 셀 페이지를 모두 지원하고 `poi_catalog`, `poi_source_catalog`, `poi_access_catalog` 뷰로 논리 엔터티를 조회한다. 로컬 D1에서 RTree 지원과 VIRTUAL TABLE INDEX 실행 계획을 확인했다. 공간 범위를 먼저 줄이고 그 후보에만 Haversine을 적용한다.

현재 전체 자료는 2,856개 셀 페이지다. 로컬 최초 셀 적재에서 8,572 row writes를 측정했다. 정규화 행+인덱스 방식의 약 420,850 writes를 피하며 POI 수를 줄이지 않는다. 무료 한도는 다른 당일 작업과 합산되므로 갱신 전 Cloudflare 사용량을 확인한다. 요금제를 자동 변경하지 않는다.

추천은 isolate 내 중복 본문 공유·동시 2개 제한, 기존 D1 전역 슬롯 2개와 취소·정리 정책을 유지한다. 총 상한은 110초, 슬롯 만료는 125초이지만 기본 추천은 도로 서버의 준비나 재시도를 기다리지 않는다. 슬롯에는 임의 lease와 만료만 기록한다. 개인 좌표는 D1·수집 DB에 저장하지 않는다. 사용자가 선택한 코스의 도로 검증에만 출발/경유 좌표가 설정된 OSRM 서버로 전달된다. 주소 확인에는 JUSO로, 날씨에는 반올림한 좌표가 Open-Meteo로 전달된다. 검증 오류·취소 시 추정 좌표를 도로선이나 전송 가능한 내비 경로로 대체하지 않는다.

## 수집과 갱신 명령

저장소 루트에서 Python 3.12 이상과 `pip install osmium numpy Pillow requests`가 필요하다. 대용량 원본과 생성 DB는 Git에서 제외한다. 실제 전국 PBF를 사용하며 POI 총건수 제한을 두지 않는다.

```powershell
python scripts/poi_pipeline.py fetch-osm
python scripts/poi_pipeline.py osm
# 인증키는 셸 환경에 TOUR_API_KEY로 설정하고 로그에 출력하지 않는다.
python scripts/poi_pipeline.py tour
python scripts/poi_pipeline.py validate
python scripts/poi_pipeline.py stats
python scripts/poi_pipeline.py export
python scripts/build-terrain-tiles.py
```

OSM 파서는 node, way, area/multipolygon, 관계 멤버를 처리한다. 해석할 수 없는 관계와 이름·좌표가 불완전한 레코드는 정상값으로 보정하지 않는다. 자동차 후보는 car 접근 태그를 가진 도로 선분·주차 후보와의 거리로만 선정하며 POSSIBLE_ACCESS다. POI의 대표 좌표와 차량 접근 좌표를 분리한다.

```powershell
python scripts/update-pois.py osm
python scripts/update-pois.py tour
python scripts/poi_pipeline.py validate
python scripts/poi_pipeline.py export
```

갱신 도구는 제공자 추출물 체크섬을 확인하고 변경된 전국 스냅샷을 처리해 신규·변경·삭제를 비교한다. OSM 복제 diff 실시간 구독은 아니며 제공자의 새 전체 추출물을 이용한 증분 반영이다. 다운로드 부분 파일·공급자 페이지 캐시·수집 체크포인트를 재사용하고 실패한 세대는 활성화하지 않는다. 태그 변경으로 대상에서 빠진 POI와 삭제도 다음 완전한 세대에 반영된다. TourAPI는 새 캐시 디렉터리에서 전체 페이지·상세 갱신을 수행한다. 전체 페이지 성공 전에 기존 활성 자료를 바꾸지 않는다.

## 로컬 실행과 검증

```powershell
cd workers
npm ci
npx wrangler d1 migrations apply flowad --local --config wrangler.local.jsonc
node scripts/poi-load-public.mjs
# 격리된 OSRM을 먼저 127.0.0.1:5000에서 실행한다. 운영 URL을 넣지 않는다.
node scripts/check-national-osrm.mjs http://127.0.0.1:5000
npx wrangler dev --config wrangler.local.jsonc --port 8787 --var ROAD_ROUTING_URL:http://127.0.0.1:5000
```

별도 셸에서:

```powershell
cd workers
npm run check:ci
node scripts/validate-national-http.mjs http://127.0.0.1:8787
node scripts/poi-benchmark.mjs
cd ..
python -m unittest discover -s tests -p test_poi_pipeline.py
cd backend
mvn test
```

`poi-benchmark.mjs`는 실제 전국 D1 자료와 **OSRM Mock**으로 연산을 측정한다. 실제 도로 검증은 `.github/workflows/nationwide-validation.yml`이 별도 공개 GitHub Linux runner에서 전국 OSRM 그래프를 만들고 로컬 Worker/D1과 서울·부산·대구·제주·강원·저밀도 출발을 확인한다. 운영 인증정보·운영 DB·운영 OSRM·실차를 사용하지 않는다. 로컬 workerd와 Node 프로세스 RSS는 운영 Worker CPU/메모리 보장이 아니다. 실제 운영 사용량·콜드스타트·모바일 GPU·GPS 오차는 별도 검증이 필요하다.

Java 단독 실행은 동적 API를 프록시한다. `DYNAMIC_API_BASE_URL`을 로컬 Worker URL로 설정한다. 공개 추천·경로 검증·티켓 resolve만 프록시하며 Tesla 토큰·세션은 전달하지 않는다.

## 동적 지형과 차량

Copernicus GLO-90 2021 DSM을 129×129 정적 타일로 전처리했다. 대상 273개 중 221개 타일이 있고 52개는 누락이다. 런타임은 로컬 정적 타일만 최대 9개 요청하고 8개 LRU를 유지하며 원본 DEM을 다운로드하지 않는다. 전체 경로가 길면 최대 20km 표시 구간을 안내한다. 누락 지역은 도로 투영 평면만 사용하며 산·고도를 만들어내지 않는다. 지형 오류는 추천 응답에 영향을 주지 않는다.

Tesla OAuth·차량 목록·마지막 차량 복원·위치 동의·배터리·CSRF·단일 목적지 전송 계약을 유지한다. 동적 티켓은 동일한 경유 순서를 다시 도로 검증한 뒤 기존 미리보기로 연결한다. Tesla 전체 경유지 일괄 전송을 지원한다고 표시하지 않는다. Pleos는 동적 경유/목적지 좌표 계약을 사용한다. 추천으로 차량을 깨우거나 명령을 자동 전송하지 않는다. Android SDK가 없는 현재 PC에서 새 네이티브 빌드·실차 검증은 하지 않았다.

## 운영 배포와 복구

운영 Worker는 `flowad-api`, 도메인은 `https://ravirgo.com/flowad/`, D1은 `flowad-workers-stage2`다. Cloudflare Workers Builds가 GitHub `main`, 루트 `workers`에서 `npm run check:ci` 후 `npm run deploy`를 실행한다. `JUSO_MAP_API_KEY`, 기존 Tesla 및 암호화/서명 비밀을 유지한다. TourAPI 키는 오프라인 수집 환경에 필요하며 클라이언트·공개 gzip에 넣지 않는다.

배포 순서는 ① Render `flowad-roads` Table 상한 32 배포 ② 기존 D1 스키마·활성 포인터 확인 ③ 새 POI 마이그레이션만 적용 ④ 공개 스냅샷 체크섬/건수 검증 후 활성화 ⑤ main 병합/Workers 자동 배포다. 도로 전용 Render는 현재 `codex/korea-roads-free` 브랜치를 사용한다. 무료 인스턴스·mmap·스레드 1을 유지한다.

```powershell
cd workers
npx wrangler d1 migrations apply flowad-workers-stage2 --remote
node scripts/poi-load-public.mjs --remote --database=3a0191de-08ae-4850-8157-ccb5bf022152
```

원격 적재는 명시적 UUID 없이는 실행되지 않는다. 공개 manifest SHA를 확인하고 실패 지점 이후 재개한다. 최종 전체 건수 확인 전 세대 포인터를 바꾸지 않는다. `.wrangler/poi-import/*.rollback.sql`은 기존 활성 포인터만 기록하며 인증·사용자 데이터를 포함하지 않는다. 최초 도입 전 활성 포인터가 없었다면 롤백 시 해당 신규 provider 포인터만 제거하고 이전 Worker 버전으로 되돌린다. 기존/새 데이터 테이블은 즉시 삭제하지 않는다.

실패 시 Cloudflare의 이전 성공 deployment로 복구하거나 이전 main 커밋을 되돌리는 새 커밋으로 재배포한다. 데이터 갱신 문제는 이전 `poi_provider_state.active_dataset`으로 복원한다. 지형·공개 데이터는 코드 커밋과 함께 버전 관리된다. Tesla 세션 테이블과 비밀키를 덮어쓰거나 DB 전체를 복원하지 않는다.

## 출처와 이용 조건

- OSM: https://www.openstreetmap.org/copyright — © OpenStreetMap contributors, ODbL. 가공 공개 데이터 전체와 출처·체크섬은 `dist/data/`에서 제공하고 서비스 안내에 링크한다. 원본 geometry를 포함한 오프라인 재생성 절차를 위에 제공한다.
- 대한민국 추출물: https://download.geofabrik.de/asia/south-korea.html
- TourAPI: https://www.data.go.kr/data/15101578/openapi.do — 제공 메타데이터와 개별 자료의 이용 조건을 확인해야 한다. 현재 실수집 0건, 사진/첨부 이미지 재배포 없음. 인증키 확보 후 공급 조건과 출처를 다시 확인한다.
- OSRM: https://project-osrm.org/docs/v5.24.0/api/ — 도로 연결은 현재 통행·주차·안전의 보장이 아니다.
- DEM: https://registry.opendata.aws/copernicus-dem/ — Copernicus WorldDEM™-90 © DLR e.V. 2010–2014, © Airbus Defence and Space GmbH 2014–2018, COPERNICUS/EU/ESA. DSM 보간·재표본화·지리 범위 자르기·2배 높이 강조를 수행했으며 실제 원본 해상도는 90m다. 전체 권리/면책 문구는 웹 서비스 안내에 유지한다.
