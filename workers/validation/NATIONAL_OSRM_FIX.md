# 전국 HTTP 검증의 NoSegment 수정

## 실제 원인과 오류 경로

`src/dynamic-recommendations.ts`의 `matrix()`가 `httpJson()` 결과의 HTTP 상태가 200이 아니거나, JSON `code`가 `Ok`가 아니면 `Failure('ROAD_TABLE_UNAVAILABLE',503)`를 발생시켰다. `src/http-app.ts`의 오류 처리기가 이 코드와 상태를 HTTP 응답으로 반환한다. 본문 JSON 파싱 실패도 `utils.ts`에서 `data:null`이 되므로 같은 조건에 해당했다. 기존 네트워크/타임아웃 예외는 이 분기 전에 `httpJson()`에서 발생했고, 행렬 크기/값 오류와 스냅 응답 오류는 별도 오류였다.

최신 전국 그래프에서 다음을 실측했다.

- 기존 강원 출발점은 자동차 도로에서 **1,626.096m** 떨어져 있다. Route와 Table 모두 `radiuses=100`에서 HTTP 400 / `NoSegment`다. 반경 제한을 제거한 진단 요청은 둘 다 HTTP 200 / `Ok`이며 동일한 이격 거리를 반환했다.
- 도로 위 출발점으로 수정한 뒤에도 22개 좌표 중 **인덱스 8의 POI 접근 후보**가 **563.010m** 떨어져 있었다. 엄격한 전체 Table 요청과 Route 요청 모두 같은 인덱스에서 `NoSegment`가 재현됐다. 이 접근점은 공개 OSM 도로/주차 태그로 찾은 미검증 후보이며, OSRM car 프로필에서 통과 가능한 도로라는 보장이 없다.
- 기존 저밀도 출발점도 도로에서 **243.126m** 떨어져 있어 이후 같은 오류가 발생할 조건이었다.
- 잘못된 Route/Table 옵션은 각각 HTTP 400 / `InvalidQuery`, Table 33개 좌표는 HTTP 400 / `TooBig`로 구분됐다. 정상 22개 Table은 HTTP 200 / `Ok`이며 duration과 distance 모두 유효했다.

`deploy/osrm/Dockerfile`과 CI는 Geofabrik의 `south-korea-latest.osm.pbf` 전체를 다운로드하여 car.lua extract → partition → customize(MLD)한다. 지역 clipping은 없다. 로컬에서 새로 다운로드한 원본은 291,897,143바이트, SHA256 `d3dcc6478ee3dfc9898956211009bfc88300ca918edb30e34848fa817e881a89`이며 공개 POI 스냅샷과 같은 원본이다. 강원을 포함한 6개 지역의 실제 Route/Table 성공으로 그래프 범위도 확인했다.

서버는 `start.sh`의 MLD/mmap/스레드 1, Table 상한 32 설정을 사용한다. CI 포트는 host 5000 → container 10000이다. Worker는 로컬 설정과 `--var ROAD_ROUTING_URL:http://127.0.0.1:5000`을 사용하며 loopback HTTP는 허용한다. 좌표 순서는 경도,위도이며 Table의 `annotations=duration,distance`, 힌트 비활성화, 좌표별 반경 개수는 유효하다. 설정·연결·파싱 문제가 이번 NoSegment의 원인은 아니다. Nearest만 확인하던 readiness는 별도의 검증 공백이었다.

## 수정

- Table 1회에서 미검증 POI의 스냅 정보를 받아 100m 초과 후보의 행/열을 `null`로 차단한다. 출발·복귀의 반경은 100m다. 최종 Route 요청과 응답의 100m 검증은 그대로다. 먼 스냅으로 만든 경로나 직선 추정 경로는 반환하지 않는다. Table/Route 재시도도 추가하지 않았다.
- 공개 테스트 출발점 두 개를 각각 가장 가까운 실제 도로 좌표로 수정했다. HTTP 200, 실제 OSRM 제공자, `ROAD_ROUTED`, geometry 및 티켓 검증은 유지/강화했다. 기존 강원 출발점의 부정 대조군은 여전히 503으로 거부된다.
- `check-national-osrm.mjs`는 실제 최대 부하인 22개 좌표 Table의 HTTP/OSRM 코드·두 행렬·스냅 정보를 검사한다. 기동 중 응답 없는 연결에만 최대 120초 동안 조건부 폴링하고, HTTP 오류/잘못된 요청·응답은 즉시 실패한다. 이어 6개 지역의 Route/Table을 각각 확인한다.
- Table 실패는 상태, 허용 목록의 OSRM 코드, 좌표 개수, 시간, 원인만 JSON으로 기록한다. URL·좌표·본문·공급자 메시지·티켓·인증정보는 기록하지 않는다. 연결 실패, 타임아웃, 취소, 크기 제한, JSON/행렬/스냅 오류, NoSegment/TooBig/요청 오류를 구분한다.
- CI는 `always()` 진단 단계에서 Worker 로그, Docker 로그, 상태/OOM 여부와 메모리/CPU/PID 통계를 출력한 뒤 별도 `always()` 단계에서 컨테이너를 제거한다. Worker는 독립 프로세스 그룹을 EXIT trap으로 종료한다. Wrangler 준비 대기의 시간 초과도 명시적으로 실패한다.

## 검증 결과와 한계

2026-11-16, macOS arm64의 Colima Linux Docker OSRM v5.27.1 + 로컬 workerd/D1에서 새 전국 그래프를 구축하고 검증했다. 공개 POI 42,085건의 체크섬/적재 건수를 확인했다. Table readiness는 기동 직후 연결 거부를 실제로 관측한 뒤 준비 완료를 확인했다.

| 지역 | HTTP | 실제 도로 코스 | geometry 점 |
|---|---:|---:|---:|
| 서울 | 200 | 5 | 141 |
| 부산 | 200 | 5 | 279 |
| 대구 | 200 | 5 | 109 |
| 제주 | 200 | 5 | 154 |
| 강원 | 200 | 3 | 530 |
| 저밀도 | 200 | 4 | 251 |

모든 지역에서 Table 1회·최종 Route 최대 5회, 실제 도로 geometry·시간 합계·티켓 resolve 검증을 통과했다. 서울 티켓은 추가 도로 재검증도 통과했다. `npm run check:ci`의 타입/린트/147개 테스트/프런트 검사가 통과했다. 추가 회귀 테스트는 부적합 POI 제외, 출발점 엄격성, null 연결, 각 오류의 구조화 로그와 민감 정보 미기록을 검사한다. 워크플로 YAML 파싱과 `git diff --check`도 통과했다.

의도적인 부정 대조군 실패 후에도 Worker NoSegment 로그와 Docker 로그/통계를 확보했다(당시 약 275MiB, CPU 0%, OOM false). Wrangler 프로세스 그룹, 테스트/전처리 컨테이너 제거를 확인했고, 검증을 위해 켠 Colima도 종료했다. macOS의 기존 Control Center가 사용하는 5000 포트는 종료 대상이 아니다.

측정 요약 `national-osrm-local.json`과 상세 로컬 로그 `data/generated/osrm-validation/`는 Git에서 제외하는 로컬 검증 산출물이다. 운영 Cloudflare/D1, Tesla 계정·차량 명령은 사용하지 않았다. 이 기록 작성 당시 원격 GitHub Actions Ubuntu 실행은 아직 하지 않았으며, 로컬 6개 대표 출발점 통과가 모든 POI의 자동차 접근·실시간 통행 가능성을 보장하지는 않는다.

## Pleos 통합 브랜치 병합 후 재검증

`codex/pleos-integration`의 main 병합 결과에 전국 기능과 OSRM 수정 커밋 `bcc83ab`를 함께 통합했다. 전국 동적 추천·공개 POI·동적 지형·서명 티켓 검증을 사용하고, 기존 main의 Tesla/Pleos 후속 수정과 도로 배포/진단 도구는 보존했다. 실제 코드의 Table 상한 32를 유지하고 기존 배포 문서의 상한 3 설명을 정정했으며, `.env.example`에 Java의 `DYNAMIC_API_BASE_URL`을 추가했다.

병합된 작업 폴더에서 로컬 D1 공개 POI 42,085건을 적재하고 앞서 구축한 전국 그래프를 재사용해 22좌표 readiness, 6개 지역 Route/Table 및 전국 HTTP 검증을 다시 통과했다. 지역별 코스 수와 geometry 점 수는 위 표와 같다. Workers 147개, Java 52개, Android 10개, POI 수집 파이프라인 5개 테스트와 Android APK 빌드가 통과했다. Python의 누락된 `osmium`은 별도 임시 venv에 설치하여 테스트했으며 전역 환경은 변경하지 않았다. 이 재검증의 상세 로그는 무시된 `data/generated/combined-validation/`에 있다.
