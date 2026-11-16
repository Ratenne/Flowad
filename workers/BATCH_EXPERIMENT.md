# OSRM Batch Adapter 실환경 검증 (2026-11-12)

**실험 구현·배포·실제 API 비교는 완료했다. 무료 CPU 안정성은 FAILED, 운영 전환은 BLOCKED다.** 후보10개·추천 점수·정렬·제외 조건을 유지했다. 기존 도로 서버와 운영 Route를 바꾸지 않았다. 최종 테스트 Worker도 직접 호출 모드로 복구했다.

## 1. 실제 도로 서버 조사

Render 대시보드와 [실제 배포 소스](https://github.com/Ratenne/Flowad/tree/858c4ef8c90dbc531bf28b45f40d40f337a4a82e/deploy/osrm)를 읽었다.

- 기존 서비스 `flowad-roads`, ID `srv-dbieeqec6qcc73a9dm70`, Singapore Free. 표시 한도 CPU0.15, RAM512MB. 기동 로그의 memory.max는536,870,912바이트였다.
- repository `Ratenne/Flowad`, branch `codex/korea-roads-free`, commit `858c4ef8c90dbc531bf28b45f40d40f337a4a82e`.
- `deploy/osrm/Dockerfile`: OSRM5.27.1, Geofabrik 한국 PBF, extract/partition/customize 빌드. 한국 도로 데이터를 이미지에 포함.
- `start.sh`: MLD, mmap=1, threads1, PORT기본10000, 최대route20점. 알고리즘은 이 서버에서 실행된다.
- 기본 로컬 브랜치에는 이 배포 파일이 없었다. 서버 설정의 브랜치를 확인한 뒤 해당 커밋을 읽었으며, 기본 Dockerfile을 도로 서버 구성으로 오인하지 않았다.

같은 서비스에 추가하려면 내부 OSRM 포트와 외부 Adapter 포트를 분리하고 runtime/supervisor·메모리를 다시 검증해야 한다. 기존 서비스의 변경·재배포가 필요하므로 실행하지 않았다. 현재 PC에 Docker/Go 빌드 도구도 없어 같은 컨테이너 결합의 실행 가능성을 검증 완료로 표시하지 않는다.

## 2. 분리한 임시 실험 구현

`Cloudflare test Worker → 별도 Render Node Batch Adapter → 기존 Render OSRM` 구조를 만들었다. 같은 호스트 프로세스의 효과를 검증한 것은 아니며, Render 사이의 공개 HTTPS 왕복이 추가된다. Render 의존성 제거안이 아니다.

Adapter: [실험 브랜치](https://github.com/Ratenne/Flowad/tree/codex/osrm-batch-experiment/experiments/osrm-batch), 코드 commit `5a9d72356a7fd1b04f4b04b921e7f318fd5d9334`. 서비스 `flowad-batch-experiment`, ID `srv-dbqprjjm8hqs73ei1e10`, [실제 HTTPS 주소](https://flowad-batch-experiment.onrender.com/health). Singapore Free(CPU0.1/RAM512MB), Node22.23.5, 외부 npm 의존성 없음. 신규 무료 서비스의 표시 CPU 한도는 기존 서비스와 달랐으므로 같은 값이라고 가정하지 않았다.

후보별 waypoint location/distance, leg distance/duration, HTTP status/code만 반환한다. geometry/steps/hints/name 등 미사용 필드는 보내지 않는다. 후보를 순서대로 실행하고 NoSegment400은 계속, 403/429/전역 장애는 이후 호출을 중단한다. Worker가 원래 `roadResponse()` 검증과 추천 루프를 사용한다. 기상 제외·인접 중복 지점 검증도 먼저 적용한다. 조기 종료 뒤의 기상 제외 수까지 과도하게 증가시키지 않는다.

body16KiB, 최대10개×20점, 응답4MB, upstream 각8초, 전체 Worker batch85초, Node request90초, 동시 batch1개, 인증 필수, SSRF를 막는 고정 OSRM 주소, 자동 재시도 없음. 과부하503은 성공으로 변환하지 않는다. 명령·Tesla 인증·GPS·사용자 데이터를 이번 실험에 사용하지 않았다.

## 3. 실제 Cloudflare 비교

Wrangler tail의 요청별 cpuTime/wallTime. 공개 서울 좌표, 시간180/1440분, 풍경4종, 산책 여부로 만든12가지 입력을 반복했다. 같은 Cloudflare colo **LAX**에서 순차 요청했다. 시작/종료 deployment UUID가 같은지 검사했다. 스키마·HTTP request shape는 동일하다.

| 항목 | 기존 직접 호출 | Batch |
|---|---:|---:|
| 고정 버전 | `325c8009-80f2-4b16-a3dd-fd76d00b3a5c` | `2db0ee03-2644-4e21-ad11-3c210853bea8` |
| 정상 추천 표본 | 24 | 36 |
| Worker의 OSRM 관련 HTTP 경계 | 10회 | 1회 |
| CPU 최소/중앙값/p95/최대 | 10/12/16/33ms | 3/5/7/23ms |
| 10ms 초과 | 21/24 | 1/36 |
| Worker wall 중앙값/p95/최대 | 2153/2817/3673ms | 1111/1421/1446ms |
| 클라이언트 wall 중앙값/p95/최대 | 2600/3776/4561ms | 2027/4300/6298ms |
| 클라이언트 응답 decoded bytes 중앙값 | 13777 | 13777 |
| HTTP 오류/빈 추천/플랫폼 non-ok | 0/0/0 | 0/0/0 |

Batch 첫 표본은CPU23ms, 이후35개는3–7ms였다. 첫 요청에 비용이 집중됐지만 isolate 초기화·JIT·D1·crypto 각각의 운영 CPU를 분리 계측한 것은 아니다. 정확한 잔여 함수 원인은 NOT_VERIFIED이며 첫 요청을 통계에서 삭제해 성공으로 만들지 않았다. 전체 Geometry 제거는 앞선 단계에서 이미 양쪽에 적용되어 이번 차이를 geometry 처리량만으로 설명할 수 없다. HTTP 경계 수가 줄어든 전체 구조의 효과이며 네트워크·플랫폼 변동도 포함된다.

Worker wall과 클라이언트 wall은 다르다. Batch 클라이언트 p95/최대는 오히려 커서 사용자 체감 최악 지연이 해결됐다고 주장하지 않는다. wall을 CPU로 취급하지 않았고, wall−CPU 전체를 OSRM 자체 탐색 시간으로 단정하지 않았다. 1개colo·유한한 순차 표본은 장기/다중지역/동시접속 안정성의 증명이 아니다.

## 4. 결과 호환성과 응답량

전체 응답에서 `generatedAt`과 서명·만료 시각이 포함되는 `navigationTicket`만 제외한 SHA256을 비교했다. 동일12입력에 대한 Batch **36/36개가 직접 방식과 일치**했다. 추천 ID 순서, 이유, 실제 거리·시간, EV 판정, route points/legs, 상태·경고·제외 개수가 비교에 포함된다. 티켓은 별도 Workers 테스트에서 resolve한 points를 비교했다.

매 요청의10개 중 정상6개, `NoSegment`4개가 동일했다. paju/daegwallyeong/busan-forest/busan-open의 NoSegment를 성공으로 바꾸거나 snap 반경을 늘리지 않았다. **평가 대상을 상위3개로 줄이지 않았다.** 기존 기상·시간·provider 실패 제외만 유지했다. 후보의 NoSegment 비율40%와 최종 API HTTP 오류율0%를 구분한다.

공개 fixture의 OSRM 직접 요약 응답 합계5274바이트, Batch 응답3691–3693바이트(metrics포함). 실제 OSRM까지의 요청은 여전히10회이며 Adapter가 같은5274바이트를 읽는다. Cloudflare로 전송하는 양이 약30% 줄었다. 프런트로 반환되는 추천 JSON 크기는 같으며 이 수치를 클라이언트 대역폭 절약으로 해석하지 않는다. 3D의 로컬 하이라이트 파일·Tesla 개별 목적지 full geometry·Pleos points 티켓은 변경하지 않았다. 앞선 무료 summary 모드의 모의 충전 geometry 제한도 이번 실험이 해결하지 않는다.

## 5. Render CPU·RAM·기동/timeout

별도 Adapter를 직접5회 호출했다. 첫 측정의 프로세스 CPU(user+system)는135.863ms, 이후4개는20.624–26.062ms였다. CPU 측정 범위는본문 수신 시작부터OSRM 처리 완료까지이며 지표 파일 읽기·마지막 응답 직렬화는 제외된다. wall은Adapter718.77–1024.04ms, 클라이언트834–1401ms, upstream 대기는717.77–1021ms였다. RSS는첫 시작약56.7MB에서마지막70.2MB, 프로세스 peakRSS77.2MB, cgroup memory.current 약30.6–33.2MB였다. RSS와 cgroup은 다른 계상값이며 같은 값으로 가정하지 않는다. 측정 당시 uptime은20.9–24.6초로 신규 프로세스의 초기 요청이다. 이것은 Render 유휴 복귀 시간을 잰 수치가 아니다.

**기존 OSRM의 실사용 CPU·RAM은 NOT_VERIFIED**. 대시보드에서 유료 application metrics를 요구했고 Free Shell/SSH도 지원되지 않았다. 별도 Adapter의 수치를 OSRM에 대신 기입하지 않았다. 기존 서버에 계측 코드를 넣거나 유료 기능을 켜지 않았다.

초기 직접 호출24건은 HTTP200이지만 모두 빈 추천/routingFailed1로 전역 장애 중단이었다. 이 낮은CPU1–14ms 표본은 정상 비교에서 제외했다. 기존 nearest도15초 timeout을 관측했고, 이후 HTTP200을 서버 Date11:15:13GMT에 확인했다. Render 로그에는 **20:11:24KST OSRM 새 프로세스 기동**과 memory.max가 기록됐다. 초기 실패 구간과 기동은 확인했지만 연속 readiness polling이 아니어서 정확한 유휴 복귀 시간·오류의 upstream HTTP 코드는 확정하지 못했다. 기존 서비스의 재시작/절전을 강제하지 않았다.

별도 Adapter의 실제 배포 시작은약29–31초였다. 이것 역시 유휴 콜드 스타트와 다르다. [Render 공식 무료 제한](https://render.com/docs/free)은15분 유휴 절전과 복귀 지연을 명시한다. 두 개의 무료 Render 서비스는 두 개의 절전 지점을 남긴다. 동시 요청·대형 입력·8/85초 경계에 대한 실네트워크 timeout stress는 미검증이다. Node/Workers Mock에서는 네트워크 실패, 권한/429/503 중단, 잘못된 body/인증/순서/ID를 검사했다.

## 6. 상태와 남은 구조 대안

- IMPLEMENTED / DEPLOYED / REAL_API_VERIFIED: 별도 Batch Adapter, 테스트 Worker opt-in, 실제 OSRM 후보10개와 응답36건 일치 검증.
- BUILD_PASSED / LOCAL_TEST_PASSED / MOCK_TEST_PASSED: TypeScript·Lint, Workers102 tests/7files, Node Adapter7 tests, 실제 Wrangler 빌드/배포.
- FAILED: 무료 CPU10ms 안정성. BLOCKED: 운영 전환.
- NOT_VERIFIED: 최초 요청23ms의 세부 함수 기여율, 원격 OSRM CPU/RAM, 실제 idle-wake 시간 상한, 동일컨테이너 방식, 장기/동시/다중지역 부하.

다음 실험 후보는 추천 전용 Worker entry를 분리해 사용하지 않는 Tesla/주소 변환 등의 초기화 경로를 줄이는 것이다. 후보10개·quota·HMAC 권한은 유지해야 한다. 첫 요청과 warm을 각각 반복 계측하고, module 초기화/JIT·D1·crypto를 운영 profiler로 구분해야 한다. **이 변경이23ms를10ms 밑으로 만든다는 보장은 없고 아직 구현하지 않았다.** 단순 warm-up 요청을 안정성 대책으로 삼지 않는다.

Render까지 없애면서 동일한 추천 결과를 보존하려면 동일 OSRM 버전/한국 graph/profile을 유지하는 실행처가 필요하다. 다른 도로 제공자나 차량 순정 내비로 바꾸면 거리·시간과 추천 순서가 달라질 수 있으므로 현재 계약을 그대로 보존한다고 주장할 수 없다. 한국 전체 mmap 데이터의 OSRM을 Workers 메모리128MB와 요청CPU10ms에서 실행 가능하다고 확인한 자료도 없다. self-hosted/별도 실행처 또는 데이터 범위를 바꾸는 대안은 비용·가용성·동일 graph·사용자 동의를 별도로 검토해야 한다. 이번에는 새 유료 실행처나 API를 선택하지 않았다.

## 7. 최종 보존·복구 상태

테스트 Worker는 직접 모드 버전 `44247103-88de-4ce8-879e-5bbad857b648`로 복구했다. OSRM_BATCH_URL 바인딩 없음, 실험 토큰 Secret만 별도 유지. 운영 `ravirgo.com/flowad*`는 `flowad-path-proxy` 그대로다. 기존 OSRM branch/배포 commit858c4ef도 동일함을 읽기 전용으로 재확인했다. 기존 Spring Boot·frontend·Android/Pleos 소스, Tesla callback/기존 secrets는 변경하지 않았다.

새 무료 Render Adapter는 인증이 필요한 실험 서비스로 남겨뒀으며, Worker 기본 경로에서는 사용하지 않는다. 유휴 시 절전되고 무료 instance-hours를 공유하므로 영구 운영안으로 취급하지 않는다. 재현/설정/복구 명령은 `experiments/osrm-batch/README.md` 참조.

설정 도중 실험용 신규 키가 브라우저 상태 출력에 포함되어 교체했다. 최종 키의 실제 인증200과10개 호출을 확인했고 기존 키를 현행 환경에서 제거했다. 키 자체는 evidence/소스/보고서에 넣지 않는다. 기존 사용자 인증 토큰이나 Tesla secret은 읽거나 교체하지 않았다.

추가/수정 파일: `experiments/osrm-batch/{package.json,adapter.mjs,server.mjs,test/adapter.test.mjs,README.md}`, `src/{batch-routing.ts,routing.ts,recommendations.ts,types.ts}`, `test/batch-routing.test.ts`, `.dev.vars.example`, `scripts/{measure-recommendation-cpu.mjs,probe-batch-adapter.mjs,export-batch-evidence.mjs}`, 이 문서와 `evidence/batch-{comparison,adapter-metrics}.json`, 배포 화면. 저장소의 기존 tracked 파일에는 변경이 없고 Workers/experiments는 아직 로컬 untracked 상태다. GitHub에는 별도 실험 branch의 Adapter3파일만 올려 기존 배포 branch를 보존했다.

초기 제공자 실패 표본과 설정 변경이 겹친 별도 run은 정상 고정 버전 비교에서 제외하고 사유를 evidence에 기록했다. 모든 실제 수치는 `evidence/batch-comparison.json`에 있다. 공식 예산: [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).
