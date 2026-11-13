# OSRM Batch 임시 실험

기존 `flowad-roads`와 운영 Worker Route를 변경하지 않는 별도 Node 서비스다. 경로 알고리즘은 기존 OSRM에서 실행된다. 이 Adapter는 Render 의존성을 제거하지 않는다.

확인한 기존 서비스: Singapore, Free, CPU0.15 / RAM512MB, `Ratenne/Flowad`의 `codex/korea-roads-free`, 배포 commit `858c4ef8c90dbc531bf28b45f40d40f337a4a82e`. `deploy/osrm/Dockerfile`이 OSRM5.27.1과 한국 PBF를 빌드하고, start.sh는 MLD·mmap·threads1, route 최대20점으로 실행한다. 현재 로컬 기본 브랜치에는 이 배포 디렉터리가 없으므로 운영 파일을 임의로 덮어쓰지 않는다.

## 프로토콜

`POST /v1/routes/batch`, JSON `{version:1,routes:[{id,coordinates:[[longitude,latitude],...]}]}`. 고정된 OSRM_BASE_URL만 사용하므로 요청자가 외부 목적지 URL을 지정할 수 없다. 최대10개, 각각2–20점, body16KiB, upstream response4MB, 각 query8초 timeout, 재시도 없음. `Authorization: Bearer <BATCH_TOKEN>` 필수. 동일 프로세스에서 동시에 하나만 실행하며 다른 batch는503을 반환한다. 주소·위치·토큰·upstream body를 로그에 쓰지 않는다.

OSRM은 원래 순서로 호출한다. `steps=false,overview=false,generate_hints=false`, radiuses100m를 유지한다. 반환값은 후보별 HTTP status, code, waypoint location/distance, leg distance/duration만 남긴다. `NoSegment` 400은 다음 후보를 계속 처리한다. 403/429/다른 HTTP 오류 또는 네트워크 실패는 이후 호출을 하지 않고 placeholder를 돌려준다. Workers는 기존 `roadResponse()` 검증과 기존 추천 루프를 그대로 적용하므로 원래 전역 장애 시 제외 개수·중단 순서도 보존한다. geometry/스냅 검증을 통과했다고 위조하지 않는다.

## 분리 배포

실제 실험 서비스 `flowad-batch-experiment`, Singapore Free(CPU0.1 / RAM512MB), Node22, branch `codex/osrm-batch-experiment`, root `experiments/osrm-batch`, build `npm install --ignore-scripts --no-audit --no-fund`, start `node server.mjs`. 배포 코드 commit `5a9d72356a7fd1b04f4b04b921e7f318fd5d9334`.

- `OSRM_BASE_URL=https://flowad-roads.onrender.com` (일반 설정)
- `BATCH_TOKEN`: 신규 실험용 안전 난수. 기존 Tesla·HMAC·AES키와 공유하지 않는다.
- `NODE_VERSION=22`, `PORT`는 Render 할당값.
- health `/health`.

로컬 `npm test`, 환경 변수 설정 후 `npm start`. 패키지 외부 의존성이 없다. localhost OSRM의 경우에만 HTTP 허용. 기존 이미지에 합치려면 OSRM을 내부5000번, Adapter를 외부PORT에 두고 별도 runtime/supervisor/메모리 검증이 필요하다. **동일 컨테이너 배포는 이번에 실행·검증하지 않았다.** Docker/Go 빌드 도구는 현재 PC에 없고 원래 이미지를 재배포하지 않았다.

## Workers 연결과 복구

`OSRM_BATCH_TOKEN`을 테스트 Worker Secrets에 별도 등록한다. `OSRM_BATCH_URL`이 있고 FREE_PLAN_MODE=true일 때 추천만 batch를 사용한다. 기존 full geometry 및 Tesla 개별 목적지 검증은 원래 client를 사용한다. 코드에서 선택 후보를3개로 줄이지 않는다.

```powershell
cd workers
# 테스트 Worker만 batch 모드
npx wrangler deploy --config wrangler.stage2.jsonc --var OSRM_BATCH_URL:https://flowad-batch-experiment.onrender.com
node scripts/measure-recommendation-cpu.mjs batch-fixed 24
# 원래 직접 호출 모드로 복구 (운영 Route 변경 없음)
npx wrangler deploy --config wrangler.stage2.jsonc
```

`wrangler.production.jsonc`에는 Adapter 주소를 넣지 않는다. 장애 시10회 직접 호출로 자동 재시도하는 fallback도 없다. 기존 Render 서비스·기존 secrets는 덮어쓰지 않는다.

## 계측 한계

응답 metrics는 Adapter 프로세스의 cpuUsage, RSS/peakRSS, cgroup memory.current, uptime/bootId, upstream bytes/대기 시간을 나타낸다. **다른 서비스인 OSRM의 CPU/RAM은 측정하지 못한다.** CPU는 user+system microseconds이며 wall time과 다르다. RSS와 cgroup 사용량은 페이지 계상 방식이 달라 직접 동일시하지 않는다. startup/JIT/GC/플랫폼 잡음이 포함된다. 별도 서비스라 Render 간 공개 HTTPS 왕복도 포함한다.

Render Free에서 원래 서비스의 CPU/RAM 그래프·Shell은 지원되지 않는다. 유료 활성화나 기존 서비스 재시작 없이 OSRM 내부 실사용량·강제 콜드 스타트를 얻을 수 없다. 유휴 후 장애 표본과 정상 표본을 섞어 CPU 성공으로 판단하지 않는다. 낮은 CPU의 빈 추천도 정상 추천 벤치마크에서 제외한다.

최종 실제 수치/통과 여부는 `workers/BATCH_EXPERIMENT.md`와 `workers/evidence/batch-comparison.json`을 참조한다.
