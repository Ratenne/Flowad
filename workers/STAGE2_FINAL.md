# 2단계 최종 추천·도로 검증 정책

상태: 구현 및 테스트 배포 준비. 운영 Route 전환 전 별도 승인이 필요하다. 최신 배포·검증 결과는 후속 기록으로 추가한다.

## 기본 추천

`POST /api/recommendations`는 설정된 ROAD_ROUTING_URL/OSRM_BATCH_URL과 무관하게 외부 도로 API를 호출하지 않는다. 원래 후보10개·Haversine×1.18·평균55km/h·정차/산책 예산·기상 제외·점수/다양성·EV 입력의 의미를 유지한다. route.status는기존 `ESTIMATED_NOT_ROAD_ROUTED`다. route.points/legs/navigationTicket은 유지한다. 실제 도로가 없으므로 batteryStatus는 기존 ROAD_ROUTE_REQUIRED로 보수적으로 표시하며 실제 EV 주행을 보장하지 않는다.

실제 도로 기반 순위/시간 제외와는 결과가 달라질 수 있다. 실제 OSRM NoSegment도 기본 추천을 제거하지 않는다. 이 후보는 선택 도로 검증에서 실패하며 전송할 수 없다. 기존 외부 연결 없는 Java 계약을 기준으로 호환성을 검사한다.

## 선택 검증

새 `POST /api/navigation/verify`: 기존 HMAC ticket과 차량 입력/왕복 시간/산책 여부를 받는다. 서명·만료를 검사하고 서명된 출발/복귀 위치와 기존 코스 경유 순서로 OSRM을 직접1회 호출한다. steps=false/overview=false, radiuses100m, waypoint 허용100m 및 구간 수/양의 거리·시간 검증을 유지한다. 성공한 경우 실제 스냅 좌표를 route.points에 담고 새 HMAC ticket을 발급한다. 전체 도로 geometry는 요청하지 않는다.

성공: verificationStatus=ROAD_ROUTE_VERIFIED, roadVerified=true, 기존 route.status=ROAD_ROUTED, 실제거리/시간, EV 재평가, 설정 시간 초과 여부, 호환 navigationTicket. 실패: ROAD_ROUTE_UNAVAILABLE/roadVerified=false 및 기존 세부 오류 코드. 추정 fallback·자동 재시도·절전 방지 ping 없음. `/api/navigation/resolve` 계약은 그대로다. 추정 ticket을 resolve할 수 있다는 사실은 차량 전송 권한이 아니다. Android/Pleos는 검증 API가 반환한 ROAD_ROUTED ticket을 사용해야 한다.

Tesla `/navigation/preview`는 기존 courseId/좌표 요청도 받되 새 ticket/차량 조건 요청을 우선 지원한다. 전체 왕복을 검증한 뒤 서버 세션의5분 계획에 roadVerified=true를 저장한다. 실패한 새 검증은 이전 미전송 계획을 무효화한다. `/navigation/send`는 만료·차량 소유권·중복·CSRF뿐 아니라 서버 검증 플래그를 확인한다. 예전 D1 미전송 계획에 플래그가 없으면 전송을 차단하고 다시 Preview하도록 한다. 단일 목적지 교체만 지원하며 실제 명령을 테스트에서 자동 실행하지 않는다.

화면은 기존 상세/3D 하이라이트를 유지하고, 명시적 도로 확인/전송 준비 동작에서만 검증한다. 검증 전후 거리·시간과 EV 한계를 표시하며, 실패·로그인 전·차량 선택 전 이유와 수동 재시도를 제공한다. 기존 native bridge가 있다면 도로 검증이 성공한 새 ticket만 전달한다. Android/Pleos SDK 자체는 수정하지 않는다.

## 검증 및 운영 절차

현재 TypeScript/Lint 및 Workers110개 테스트 통과. 기존 Java 계약27개 포함. 엔진·10개3D terrain 자산 테스트 통과, app.js syntax 통과. 실환경 검증과 운영 전환은 별도 기록한다. Mock을 실제 API 검증으로 표시하지 않는다.

테스트: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. 테스트 배포: `npx wrangler deploy --config wrangler.stage2.jsonc`. 운영 승인 후: `npx wrangler deploy --config wrangler.production.jsonc`, `node scripts/switch-production-route.mjs --approved-cutover`. 롤백: `node scripts/switch-production-route.mjs --rollback`, 필요 시 stage2 config 재배포. 기존 Pages/OSRM/Java/프록시/DNS는 보존한다.

기존 Batch 실험 소스와 측정 요약을 보존하되 필수 운영 의존성으로 사용하지 않는다. 추천 전용 Worker 실험은 중단했으며 해당 Entry/config를 추가 배포하지 않았다. 민감한 계정/차량 관측이 포함될 수 있는 로컬 evidence와 STAGE2_DEPLOYMENT 문서는 Git에서 제외한다. Secret은 Secrets/ignored .wrangler 또는 .dev.vars에만 있고 예제에는 빈 값만 둔다.
