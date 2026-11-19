# Flowad 탐색 UX 및 실제 지형 개선 (2026-11-19)

## 변경 및 보존 범위

- 추천 목록과 선택 상태는 재추천 중·실패 시 유지한다. 같은 진행 중 요청은 합치며 늦은 응답은 무시한다. 주변 다시 찾기는 확보한 출발 위치를 재사용한다.
- 기본 추천은 기존 전국 POI 탐색을 그대로 사용하며 OSRM을 호출하지 않는다. 도로 제공자의 429는 선택 도로 검증 실패로 유지하며 성공으로 위장하지 않는다.
- 동적 지형의 필수 도로 geometry 의존성을 제거했다. 실제 주요 경유지 분포를 사용하고, 넓게 분산되면 가장 많은 경유지를 포함하는 대표 영역을 선택한다. 전체 경유지 보기에서 나머지를 확인한다.
- Copernicus 메시, 기존 녹색·베이지 색상, 조명, 등고선, 높이 2배, 해발 표시와 카메라 조작을 유지한다. 도로선이 있는 기존 자산의 미리 달리기도 유지한다. 도로선 없는 코스는 차량이 가상의 도로를 달리는 대신 지형을 회전하는 ‘경유지 둘러보기’를 제공한다.
- DEM 일부 누락은 유효 셀만 렌더링하고 누락 영역은 비워 둔다. 해발 범위에 누락값을 포함하지 않는다. 전부 누락되거나 WebGL 실패 시 방문 순서를 표현하는 2D 화면으로 전환한다. 점선은 실제 도로가 아니다.
- WebGL context 복구 후 메시를 다시 만들어 빈 화면을 방지한다. 성공한 DEM·모델은 각각 최대 8개 캐시하며 동시 다운로드는 공유한다. 실패 재시도는 사용자 동작으로만 한다.
- 도로 검증 상태와 도로선 유무를 분리한다. 선택 검증은 `steps=false&overview=false`이며 추가 geometry 요청을 만들지 않는다. 실제 geometry가 있을 때만 도로선을 표시한다. 과거 하이라이트는 현재 전체 주행 경로를 보장하지 않는다.
- 비교 2~3개 코스는 같은 실제 지형 렌더러를 전환한다. 기본 화면의 좌표·내부 오류 코드·중복 위치/설정 버튼을 숨기고 주소와 사용자 안내를 유지한다.
- 차종과 연결 방식을 분리한다. Tesla 선택 시에만 세션 확인 및 인증 UI를 제공한다. Pleos는 실제 브리지 존재 여부를 확인한다. 익명·기타 차량 사용자도 탐색·저장이 가능하다.
- 차량 전송 전 검증된 티켓과 명시적 사용자 동작을 유지한다. Android 서버 응답 파서도 추정 상태를 거부한다. Tesla 단일 목적지 정책과 서버 OAuth·CSRF·명령 중복 방지는 유지한다.
- Route, DNS, D1, Secret, OAuth callback 및 기존 지형 자산은 변경하지 않는다.

## 재현 및 검증

```powershell
cd workers
npm run check:ci
npm run build
```

`scripts/qa-discovery-browser.js`는 Playwright의 `async(page)` 함수다. 로컬 파일을 격리된 `flowad.test`에 제공하며 추천·날씨·위치·차량 응답은 Mock이다. PC, 모바일 WebGL 미지원, Android WebView UA 시뮬레이션, 네이티브 브리지 Mock 및 DEM 실패를 검사한다. 실제 DEM/Three.js를 사용한다. 실제 차량 명령은 없다.

`scripts/qa-terrain-quality.js`는 같은 양평 지형 자산으로 변경 전후, 도로선 없는 동적 지형, 부분 DEM 누락을 비교한다. 변경 전 파일은 테스트 기준 커밋 `31587a4`의 `dist/terrain-view.js`, `terrain-model.js`, `dynamic-terrain.js`를 `artifacts/ux-baseline/`에 추출해 사용한다. 화면 캡처는 무시된 `artifacts/terrain-quality-*.png`에 저장한다. 같은 자산의 해발 범위는 전후 24–632.3m로 동일하다. 동적 타일은 범위와 표본화가 달라 기존 파일과 수치가 같을 필요는 없다.

자동 검증은 실제 GPS 정확도, Android APK/WebView, GPU별 품질, Tesla 인증 또는 실차 전송 성공을 보장하지 않는다. 이 환경에는 Android SDK/adb 설정이 없어 추가 Android 계측 테스트는 실행하지 못했다.

## 배포와 롤백

기존 `workers/wrangler.jsonc` 및 `keep_vars`로 `flowad-api`를 배포한다. D1 마이그레이션은 없다. 배포 전 상태는 무시된 `workers/.wrangler/ux-rollback/before.json`에 보존했다. 변경 전 운영 버전은 `02acdcdc-9e64-4a6e-ae77-55b287fe42c2`다.

문제가 있으면 `workers`에서 `npx wrangler rollback 02acdcdc-9e64-4a6e-ae77-55b287fe42c2`로 직전 코드·정적 자산을 되돌린다. GitHub 자동 배포가 다시 변경 버전을 올리지 않도록 해당 커밋을 revert 후 push한다. Route·DB·Secret은 변경할 필요가 없다.

운영 확인은 공개 예시 출발 좌표의 추천 HTTP 200, 실제 응답 코스 개수, `diagnostics.tableCalls=0`, `routeCalls=0`, 새 정적 자산 및 지형 화면을 확인한다. 개인 위치·티켓·인증 정보는 검증 출력이나 문서에 기록하지 않는다. 실차 명령 테스트는 수행하지 않는다.
