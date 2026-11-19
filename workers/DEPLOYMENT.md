# Flowad 운영 배포

운영 Worker는 `flowad-api`이며 `ravirgo.com/flowad*`의 화면과 API를 함께 제공한다. 운영 코드는 GitHub `Ratenne/Flowad`의 `main` 브랜치다. 로컬 커밋 후 GitHub에 push하거나 PR을 main에 병합해야 자동 배포가 시작된다.

## Cloudflare Workers Builds

- Git 저장소: `Ratenne/Flowad`
- 프로덕션 브랜치: `main`
- 루트 디렉터리: `workers`
- 빌드 명령: `npm run check:ci`
- 배포 명령: `npm run deploy`
- 다른 브랜치의 프리뷰 빌드: 비활성화

Cloudflare가 루트 디렉터리의 package-lock.json으로 의존성을 설치한 뒤 검사·배포한다. 검사가 실패하면 배포하지 않는다. 배포 결과는 Worker의 빌드/배포 화면에서 확인한다. `npm run build`는 배포 없는 dry-run이며 실제 수동 배포는 `npm run deploy`다.

GitHub의 **Cloudflare Workers and Pages** 앱에 `Ratenne/Flowad` 저장소 접근이 허용되어 있어야 push 이벤트가 전달된다. 기존 다른 사이트의 저장소 접근은 제거하지 않는다. 연결 후 main에 새 커밋을 push해 빌드와 배포가 실제로 완료되는지 확인한다.

## 설정의 기준

운영 Wrangler 설정은 `workers/wrangler.jsonc` 하나로 관리한다. `wrangler.production.jsonc`와 과거 실험용 `wrangler.stage2.jsonc`는 제거했다. 로컬 테스트는 별도 `wrangler.local.jsonc`를 사용한다.

로그·통계·성능/원격 검증 도구는 `scripts/production-target.mjs`를 통해 이 설정의 Worker 이름·운영 URL·D1 ID를 읽는다. 이름에 stage2가 남은 일부 스크립트 파일도 실행 대상은 `flowad-api`다. 운영으로 요청을 보내는 측정 도구는 `--allow-production-requests` 없이는 실행하지 않는다. `verify-remote-d1.mjs`는 별도의 `--allow-production-d1-write`와 명시적인 현재 테스트 자격 파일이 필요하며, 일반 검증에는 로컬 `npm test`를 사용한다. 이 변경 확인 과정에서 운영 부하 테스트·D1 쓰기·키 생성은 수행하지 않는다.

원인: 2026-11-16 Worker 이름 통합 후 기본 배포 설정과 Route는 갱신했지만, 그 전에 작성한 진단·성능 측정 스크립트의 하드코딩된 대상과 옛 배포 설정을 정리하지 않았다. 프런트엔드는 같은 출처의 `./api/...`를 사용하므로 이들 도구의 잘못된 참조와 실제 사용자 요청의 Route를 구분해야 한다. 과거 결과 문서는 당시 이름을 보존하며 현재 명령의 기준으로 사용하지 않는다. 재발 검사는 `node ../scripts/test-worker-target.mjs`로 수행한다.

DB는 기존 `flowad-workers-stage2`를 그대로 사용한다. 이름의 stage2는 데이터베이스 생성 당시 이름이며, Worker 통합을 위해 DB를 새로 만들거나 데이터를 이동하지 않는다. `ADDRESS_DB`는 사용하지 않는다.

런타임 Secret은 Cloudflare Worker에만 보관한다. `TOKEN_ENCRYPTION_KEY`, `NAVIGATION_TICKET_SECRET`, `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `JUSO_MAP_API_KEY`를 Git에 넣거나 빌드 로그에 출력하지 않는다. Worker 이름 변경은 기존 리소스의 ID·버전·바인딩을 유지하는 Cloudflare API로 수행한다.

지도 표시는 Naver Maps JavaScript API v3를 사용한다. `flowad-api`에 `NAVER_MAP_KEY_ID`를 등록하고 Naver Cloud 애플리케이션에서 Dynamic Map 및 Web 서비스 URL `https://ravirgo.com`을 설정한다. `ncpKeyId`에 쓰는 공개 Key ID이며 Secret Key는 사용하거나 클라이언트로 보내지 않는다. `wrangler.jsonc`의 `keep_vars: true`는 대시보드에 등록한 공개 ID가 다음 자동 배포에서 사라지지 않도록 유지한다. 키 값을 Wrangler vars에 빈 값으로 덮어쓰지 않는다. `GET /api/location/map-config`는 공개 ID만 반환하고, 누락 시 `NAVER_MAP_NOT_CONFIGURED`를 반환한다. SDK와 타일은 사용자가 지도 열기를 누른 경우에만 요청한다. 선택한 위치 주변 타일 영역이 Naver에 전달되며 지도에서 이동해도 출발지·추천은 바뀌지 않는다. 주소 문자열 조회는 기존 JUSO API를 유지한다. Naver 등록·도메인 승인·이용 한도 및 실제 타일 렌더링은 유효 키로 별도 검증해야 한다.

## 다른 서비스

지도 마커는 드래그하거나 지도 클릭으로 이동할 수 있다. 이동 중에는 기존 출발지·추천을 유지하고 주소/추천 API를 호출하지 않는다. ‘이 위치에서 출발’을 누르면 `manual` / `MAP_PICK` 출발지로 적용하고 기존 주소·날씨·추천 흐름을 실행한다. 기기나 차량이 새 위치를 제공한 뒤에는 이전 지도 선택을 확정할 수 없다. 지도 닫기·인증 실패·페이지 이탈 시 선택 상태와 이벤트 리스너를 정리한다.

Naver 키의 발급 서비스도 구분한다. 신규 Maps 키는 `NAVER_MAP_KEY_PARAMETER=ncpKeyId`, 기존 AI·NAVER API의 Web Dynamic Map 키는 `ncpClientId`를 사용한다. 현재 운영 키는 2026-11-19 신규 Maps 애플리케이션으로 전환한 것을 콘솔에서 확인했으므로 Wrangler에는 `ncpKeyId`를 명시한다. 키 값은 대시보드에만 유지한다. 서비스 이전 시 새 키와 파라미터를 함께 바꾸며, 인증 실패 시 파라미터를 무작위로 재시도하지 않는다.

Render `flowad-roads`는 선택한 코스의 도로 검증용 별도 서비스다. 이 Worker 자동 배포는 Render 설정과 도로 서버 배포 브랜치를 변경하지 않는다. Tesla 공개키를 제공하는 별도 Pages 사이트와 기존 도메인·콜백 주소도 유지한다.

## 수동 배포

```powershell
cd workers
npm ci
npm run check:ci
npm run build
npm run deploy
```

수동 배포도 운영 main과 같은 코드를 사용한다. 운영 주소·콜백·DB 설정은 배포 전 확인하고, 이후 화면·상태 API·추천 API를 확인한다. 실제 Tesla 위치·명령 요청은 운영 배포 점검 중 자동 실행하지 않는다.
