# Render Free OSRM 가용성 실험

운영 기본값은 `ROAD_KEEPALIVE_ENABLED=false`다. 이 상태에서 10분 Cron은 도로 서버와 실험용 D1 테이블을 호출하지 않는다. 30분 D1·Google Places 정리 Cron은 별도로 동작한다.

Worker 배포 전 기존 D1에 `0007_road_keepalive.sql`을 적용한다.

## 운영 활성화 조건

Render는 15분 비활동 절전, 약 1분의 자연 복귀, 워크스페이스가 공유하는 월 750시간, 무료 서비스의 더 낮은 인바운드 한도를 공개한다. 무료 인스턴스는 시험·개인 프로젝트 용도로 안내된다. 이용 정책은 사용 제한의 우회를 금지한다. 공개 문서만으로 운영 OSRM을 주기적으로 깨워 절전을 막는 이 실험이 허용되는지 확인할 수 없었다. 운영 적용 시점에 Render의 명시적 확인과 Billing 잔여 시간 확인이 확보되기 전까지 플래그를 끈다. [Render 무료 플랜](https://render.com/docs/free) · [이용 정책](https://render.com/acceptable-use) · [인바운드 429](https://render.com/docs/troubleshooting-deploys#429-too-many-requests)

조건을 모두 충족한 경우에만 시작 시각과 검토 내용을 설정한다.

| 설정 | 값과 의미 |
| --- | --- |
| `ROAD_KEEPALIVE_ENABLED` | 기본 `false`. 승인된 실험에서만 `true`. |
| `ROAD_KEEPALIVE_INTERVAL_MINUTES` | `10`. |
| `ROAD_KEEPALIVE_EXPERIMENT_DAYS` | 기본 3일, 허용 범위 3~7일. |
| `ROAD_KEEPALIVE_START_AT` | 오프셋을 포함한 ISO 8601 시작 시각. 종료는 시작 시각과 기간으로 고정된다. |
| `ROAD_KEEPALIVE_REVIEW` | JSON. `checkedAt`은 확인 시각, `policyApproved`와 `resourcesOk`는 정책과 Render 자원 확인 결과, `freeHoursForExperiment`는 다른 서비스 예약분을 뺀 잔여 시간, `baselineSuccessRate`는 비교 기준선의 0~1 성공률이다. |

Render **Billing → Monthly Included Usage**의 워크스페이스 실제 사용량을 기준으로 한다. 10분 요청이 정상적으로 계속 도달하면 30일에 약 720시간, 31일에 약 744시간을 쓸 수 있다. 이는 추정이다. 3일 실험은 72시간과 종료 직후 최대 15분의 여유가 필요하다. 다른 서비스의 예상 가동을 먼저 차감한다. 출처와 검토 시각을 남기고 검사 결과를 24시간 안에 갱신한다. 정책 확인·잔여 시간·자원 검토가 없거나 만료되면 원본 호출을 멈춘다. Render CPU·RAM과 월 사용량은 이 Worker가 자동 조회하지 않는다. 운영자가 자원 증가를 확인하면 `resourcesOk=false`로 변경하거나 실험을 즉시 중지한다.

## 프로브와 중단

- 10분 슬롯마다 최대 한 번 `https://flowad-roads.ravirgo.com/nearest/v1/driving/126.978,37.5665?number=1`에 GET을 보낸다. 서울 공개 기준점의 Nearest를 사용한다. 8초 타임아웃, 캐시 비저장, 리디렉션 차단을 적용한다. HTTP 200, OSRM `Ok`와 한 개의 결과, Render 원본 헤더·요청 ID, Cloudflare `DYNAMIC` 또는 `BYPASS`가 함께 있을 때 성공으로 기록한다. Render 기본 호스트 `flowad-roads.onrender.com`은 원본 비교에 사용할 수 있다. 프로브는 운영과 같은 커스텀 도메인을 사용한다.
- D1이 시간 슬롯을 한 번만 선점한다. 최근 30초에 사용자 검증 요청이 있었거나 제공자 429 대기·복구가 남아 있으면 건너뛴다. 프로브는 사용자의 복구 요청 자리를 선점하지 않는다. 프로브의 429는 기존 제공자 공용 대기에 기록하고 즉시 재시도하지 않는다.
- 실험 중 프로브 429가 2회 발생하거나 실패가 3회 연속이면 자동 중단한다. 접근 제한·보안 챌린지는 첫 관측에서 중단한다. 적격 사용자 검증 요청이 20건 이상이고 그 성공률이 기준선보다 10%p 넘게 낮으면 다음 Cron에서 멈춘다. 검토 실패와 실험 기간 종료도 추가 요청을 막는다. 같은 실험의 `stop_reason`이 기록되면 해당 시작 시각을 재사용해 재개할 수 없다.
- 수동 중단은 `ROAD_KEEPALIVE_ENABLED=false` 배포로 한다. 활성 실험을 즉시 중단하려면 D1의 해당 `starts_at` 행에 `stop_reason='operator_stop'`을 설정한다. 이미 발송된 1건은 8초 이내에 종료된다. 코드 롤백은 직전 Worker 버전을 활성화하고 이전 Cron 목록으로 복구한다. 운영 도로 서버 설정 변경은 필요 없다.

## 관측과 비교

| 지표 | 위치 |
| --- | --- |
| 실험 요청 시각, 응답 상태·시간, 성공·실패·타임아웃, 429, Retry-After | Workers Observability에서 `osrm_keepalive_probe` 검색. 중단은 `osrm_keepalive_stop`. |
| 실제 실행 요청 수, 성공·429 횟수, 연속 실패, 적격 사용자 성공률, 중단 사유 | 기존 D1의 `road_keepalive_experiments`. 시간 값은 Unix 밀리초. |
| 실제 사용자 응답 성공률, 25초 초과, 타임아웃, 브라우저 수동 재시도 | Observability의 `road_verification`. 초기 요청과 같은 코스의 실패 후 다음 브라우저 요청을 구분한다. 다른 클라이언트나 페이지 새로고침 이후의 수동 재시도는 확인 범위 밖이다. |
| 원본 Route의 실제 요청 수·응답 코드·시간 | `osrm_route_success`와 `osrm_route_failure`. API의 503과 원본의 429를 따로 집계한다. `osrm_keepalive_probe`는 사용자 Route 집계에서 제외한다. |
| 절전·기동 횟수, 기동 직후 지연, CPU·RAM과 무료 시간 | Render Metrics, Events·Application Logs의 OSRM 기동 기록, Billing의 실제 사용량. Worker 타임아웃만으로 절전이나 재기동을 추정하지 않는다. |

실험 집계는 `workers/`에서 읽을 수 있다. 아래 시각 표시는 UTC다.

```powershell
npx wrangler d1 execute flowad-workers-stage2 --remote --command "SELECT datetime(starts_at/1000,'unixepoch') AS starts_utc, datetime(ends_at/1000,'unixepoch') AS ends_utc, attempts, successes, rate_limits, user_attempts, user_successes, stop_reason FROM road_keepalive_experiments ORDER BY starts_at DESC LIMIT 5"
```

로그에는 공개 기준점 외의 위치, 코스 ID, 티켓 원문, 인증 데이터가 들어가지 않는다. 기준선은 원본 Route 429가 관측된 10:44:41 및 10:45:55 KST와 자연 절전 후 단일 Route 약 33.5초, Worker 상한 25초다. 기존 사건은 경향 기준이며 비교용 성공률은 사용자 로그의 별도 시간대에서 산출한다. 관측 기간 A와 종료 뒤 B에서 시간대와 유사한 트래픽을 맞춰 기동 횟수, 첫 Route 지연·p95, 성공률, 원본 429와 프로브 429를 비교한다. 요청 수와 시간대가 다르면 차이를 인과로 결론 내리지 않는다. 보존 기간 전에 집계를 보관한다. 정책 승인이 없으면 비활성 상태에서 실제 사용자 요청과 Render 기동 로그를 대조하는 관측을 유지한다. [기존 운영 기록](ROADS_FREE.md#2026-11-20-운영-조사) · [Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
