# 10개 후보를 유지한 CPU 조사 (2026-11-12)

결과: **무료 CPU 예산 적합성 FAILED, 운영 전환 BLOCKED**. 후보 축소는 적용하지 않았다. 테스트 Worker만 갱신했으며 운영 `ravirgo.com/flowad*` Route는 조회 결과 여전히 `flowad-path-proxy`다. 이 조사에서 Tesla 인증·차량 API·명령을 추가 호출하지 않았다.

후속 Batch Adapter 실험의 실제 결과·최신 배포 상태는 `BATCH_EXPERIMENT.md` 참조. 이 문서의 아래 수치는 Batch 이전 조사 기록이다.

## 실제 Cloudflare 측정

`wrangler tail`의 invocation `cpuTime`과 `wallTime`을 사용했다. 추천 요청만 비교했으며 정적 파일·400 오류의 낮은 CPU를 중앙값에 섞지 않았다. 공개 서울 출발 좌표, 시간 180/1440분, 풍경 4종, 산책 조건을 같은 순서로 12회씩 실행했다. 두 버전 모두 원래 10개 후보 루프와 실제 OSRM을 사용한다. 기상 제외 및 제공자 전체 장애 시 기존 조기 종료 규칙도 유지한다.

| 측정 | 수정 전 | 수정 후 |
|---|---:|---:|
| 버전 | `1aaa30ac-8ddb-4cc8-89fb-cbfd6a8bbc49` | `9f853038-d109-4f58-8d1b-67b926e3712d` |
| HTTP 200 | 12/12 | 12/12 |
| CPU 중앙값 | 15ms | 12ms |
| CPU 최소 / 최대 | 13 / 31ms | 9 / 33ms |
| CPU 10ms 초과 | 12/12 | 8/12 |
| 첫 표본을 제외한 CPU 범위 | 13–19ms | 9–12ms |

첫 요청의 높은 값에는 콜드/JIT 영향이 있을 수 있지만 콜드 시작만의 비용이라고 단정할 자료는 없다. p95는 12표본이라 최대값과 같으며 안정성을 입증하지 못한다. 같은 테스트의 두 구간 결과이므로 모든 차이를 특정 한 변경의 인과 효과로 단정하지 않는다.

수정 후 Worker wall time은 **2,090–2,764ms**, CPU는 **9–33ms**다. 외부 API 대기 전체를 CPU로 계산한 결과가 아니다. 전체 클라이언트 왕복 시간에는 클라이언트↔Cloudflare 구간도 포함된다. OSRM 도로 탐색은 Render에서 실행된다. Worker는 HTTP 생성·재개, 응답 수신/파싱, 스냅·구간 검증, 점수·정렬, D1 quota, 티켓 서명, 응답 직렬화를 수행한다. Worker wall−CPU를 순수 OSRM 시간이라고도 단정하지 않는다.

12개 입력 모두 수정 전후 **HTTP 상태, 추천 ID 순서, weatherExcluded, timeExcluded, routingFailed, geometryStatus**가 일치했다. `evidence/cpu-investigation.json`에 개별 표본과 비교 결과를 보존했다. 제공자 400 `NoSegment` 4건은 임의 성공 처리하거나 반경을 완화하지 않았다. 정상 응답의 routingFailed=4를 그대로 유지했다.

## 단계별 조사와 측정 한계

공식 production profiler API를 이름/latest, immutable Worker ID/활성 버전 UUID로 시도했으나 HTTP404(코드10394)를 받았다. 따라서 **운영 함수별 CPU 기여율은 NOT_VERIFIED**다. 요청 전체의 운영 CPU 측정은 성공했지만 이를 임의 비율로 쪼개지 않았다. 배포 환경의 `performance.now()`는 I/O 사이 동기 계산에서 진행되지 않을 수 있어 이를 단계별 CPU 타이머로 사용하지 않았다.

보완 조사로 **로컬 workerd Inspector CPU Profiler**에서 공개 OSRM 실응답을 재생했다. 원격 네트워크 대기를 제거한 Mock/replay이며 실제 Cloudflare CPU 수치로 승격하지 않는다. 100µs 샘플링을 요청했고 Windows의 실제 표본 간격은 가변적이다. idle/program/root 표본을 뺀 표본 시간만 합산했으므로 완전한 CPU 계측이 아니며, GC·런타임·프로파일러 비용도 섞인다. 아래 값은 해당 배치의 표본 합계/반복 수다. 서로 겹치는 작업이 있으므로 합산하거나 운영 요청에서 차감하면 안 된다.

| 작업 | 로컬 표본 평균 | 해석 |
|---|---:|---|
| 요청 Zod 검증 | 약 0.053ms / 1검증 | 100회, 간단 입력. 최대 입력의 상한 아님 |
| 요약 응답 JSON.parse | 약 0.064ms / 후보10개 | 100회. 네트워크·decode 제외 |
| 요약 응답 httpJson | 약 0.607ms / 후보10개 | 100회. Mock Response 생성·stream·decode·parse 포함 |
| 후보 평가·점수·선택·서명 전체(직선 Mock route) | 약 0.197ms / 추천1회 | 100회. 순수 점수식만의 수치 아님 |
| 실제 요약 fixture 추천 전체 | 약 1.231ms / 추천1회 | 100회. 후보10개, 네트워크·D1 제외 |
| 전체 Geometry fixture 추천 전체 | 약 19.704ms / 추천1회 | 20회. httpJson decode/parse 프레임의 self 표본이 큼 |
| D1 quota | 약 2.670ms / 1회 | 100회. **로컬 Miniflare D1**의 해시·binding·tracing·JSON 처리. 원격 D1 실행 CPU 아님 |

전체 Geometry 배치에서 `httpJson` self 프레임에 가장 많은 표본이 잡혔다. 대량 JSON 디코딩/파싱이 이 경로의 주요 비용이라는 근거지만, JSON.parse와 TextDecoder 각각의 운영 CPU를 분리 계측한 것은 아니다. Geometry 좌표 변환·검증 프레임도 포함되며 정확한 운영 기여율은 미확정이다. 거리 요약 모드에서도 실제 운영 CPU 초과가 남으므로 **전체 Geometry만 제거하면 해결된다는 주장은 성립하지 않는다**.

추천 API의 D1 작업은 IP quota 1회이며 OAuth 세션 AES-GCM 암복호화는 이 요청 경로에서 실행되지 않는다. AES를 추천 CPU 초과 원인으로 지목하지 않았다. 후보 평가와 점수는 같은 루프 안에 있어 로컬 표에서도 별도 정확한 CPU로 나누지 않았다. 원격 fetch/runtime 재개와 D1 binding 처리의 잔여 운영 비중은 profiler 없이는 확정할 수 없다.

## OSRM 응답과 Geometry 소비자

공개 좌표로 같은 10개 후보에 `steps=true/false`, `overview=false`, `generate_hints=false`를 요청했다. 전체 Geometry 합계 **1,167,766바이트 / 26,054점**, 거리·시간 요약 합계 **5,274바이트 / 0점**이었다. 6개 후보가200, 4개가400 `NoSegment`로 양쪽이 같았다. 약99.55% 응답량 감소다. 이 직접 호출의 헤더 대기 합계 1,445/1,786ms는 클라이언트 wall time이며 Worker CPU가 아니다. 호출 순서·연결 상태 차이 때문에 서버 탐색 속도 비교로 해석하지 않는다.

| 소비자 | 필요한 정보 / 현재 처리 |
|---|---|
| 추천 후보10개 점수·시간·EV 판정 | 실제 leg 거리·시간 + waypoint 스냅 검증. 전체 step Geometry 불필요. FREE_PLAN_MODE의 요약 요청 유지 |
| 기존 3D 미리보기 | `dist/terrain/`의 별도 하이라이트 도로선. 해당 파일·프런트 코드를 변경하지 않음 |
| Pleos HMAC 티켓 | 순서 있는 route.points, 거리·상태 snapshot. 전체 도로선이 아님. 기존 resolve 테스트 유지 |
| Tesla 추천 preview | 추천 경유 지점/거리·시간, 기존 단일 목적지 계획. 좌표/선택/승인 로직 유지 |
| Tesla 개별 목적지 도로 검증 | `destination()`은 **전체 Geometry를 계속 요청·검증**. 전송/실차 반영을 검증했다고 주장하지 않음 |
| 모의 충전소 근접 조회 | 프런트가 추천 leg.geometry를 사용하므로 **무료 요약 모드에서는 전체 경로 기반 조회에 필요한 입력이 없음**. 실제 충전 기능으로 표시하지 않으며, 이 기존 제한까지 해결했다고 주장하지 않음. 완전한 계약 보존을 위해서는 선택 경로 Geometry의 지연 조회와 프런트 연결이 추가로 필요 |

새 변경은 `generate_hints=false`(사용하지 않는 OSRM hint만 제외), 단일 청크 버퍼 복사 제거, 지원 런타임의 native Base64/Base64URL 사용(기존 fallback 보존)이다. 좌표·스냅 반경·score·sort·후보 수는 바꾸지 않았다. 거리 요약에 waypoint 자체는 스냅 검증상 필요하므로 제거하지 않았다. 이번 paired before/after는 **양쪽 모두 이미 Geometry 요약 모드**여서 1.17MB→5.3KB 변화와 직접 혼동하지 않는다.

## 검증 및 다음 대안

- IMPLEMENTED: 위 최적화, 측정/replay 스크립트, 10개 후보 및 추천 순서·제외 조건 회귀 테스트.
- BUILD_PASSED / LOCAL_TEST_PASSED / MOCK_TEST_PASSED: 타입·Lint·Workers 테스트 및 stage2 dry-run. 테스트는 최종 실행 결과를 STAGE2_DEPLOYMENT에 함께 기록.
- DEPLOYED: 테스트 Worker 버전만 갱신. Secret 값·D1 schema·Tesla callback·운영 Route 변경 없음.
- FAILED: 10ms 예산 안정성. BLOCKED: 운영 전환. NOT_VERIFIED: 운영 단계별 CPU, 최대 heap, 전 지역/최악 입력의 안정성.

후보를 줄이지 않는 다음 대안은 **기존 Render OSRM 옆의 batch 어댑터에서 동일한 10개 route 요청을 처리하고 필요한 waypoint/leg 결과만 한 번에 반환**하는 구조다. Worker의 10회 HTTP 경계 처리와 재개 비용을 줄일 가능성이 있지만 아직 구현·실측하지 않았고 10ms 보장도 아니다. OSRM 원래 API에 그런 endpoint가 있다고 가정하지 않는다. 어댑터 소스/배포·부분 실패 계약·timeout·기존 결과 일치 검증이 필요하다. 전체 Geometry가 필요한 경우에는 선택 경로만 지연 조회하는 별도 계약이 필요하며 기존 UI 연결까지 검증해야 한다. 기존 Render 의존성은 이 대안에서도 유지된다.

운영 profiler 접근을 확보하면 잔여 CPU를 다시 표본 수집하는 것도 가능하다. 유료 플랜 자동 전환, 후보3개 축소, 운영 Route 전환은 수행하지 않는다.

재현 순서:

```powershell
cd workers
node scripts/measure-recommendation-cpu.mjs before
# 변경/테스트 후 테스트 Worker만 배포
node scripts/measure-recommendation-cpu.mjs after
node scripts/prepare-cpu-replay.mjs
npx wrangler d1 migrations apply flowad --local --config .wrangler/profiling/wrangler.json
npx wrangler dev --config .wrangler/profiling/wrangler.json --port 8791 --inspector-port 9231
# 다른 터미널
node scripts/profile-local-replay.mjs
node scripts/export-cpu-evidence.mjs
```

`.wrangler/profiling/`은 무시된 임시 자료이며 local replay 엔트리는 배포하지 않는다. `before/after`를 덮어쓰면 이전 실행 결과가 바뀌므로 보존된 evidence와 새 측정을 구별한다.

공식 근거: [CPU/메모리 제한](https://developers.cloudflare.com/workers/platform/limits/), [Workers 타이머](https://developers.cloudflare.com/workers/runtime-apis/performance/), [운영 CPU profiler](https://developers.cloudflare.com/workers/observability/profiling-in-production/), [OSRM 옵션](https://project-osrm.org/docs/v5.24.0/api/).
