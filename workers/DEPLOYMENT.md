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

운영 Wrangler 설정은 `workers/wrangler.jsonc` 하나로 관리한다. `wrangler.production.jsonc`는 제거했다. 로컬 테스트는 별도 `wrangler.local.jsonc`를 사용한다. `wrangler.stage2.jsonc`는 과거 성능 실험용이며 운영 배포에 사용하지 않는다.

DB는 기존 `flowad-workers-stage2`를 그대로 사용한다. 이름의 stage2는 데이터베이스 생성 당시 이름이며, Worker 통합을 위해 DB를 새로 만들거나 데이터를 이동하지 않는다. `ADDRESS_DB`는 사용하지 않는다.

런타임 Secret은 Cloudflare Worker에만 보관한다. `TOKEN_ENCRYPTION_KEY`, `NAVIGATION_TICKET_SECRET`, `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `JUSO_MAP_API_KEY`를 Git에 넣거나 빌드 로그에 출력하지 않는다. Worker 이름 변경은 기존 리소스의 ID·버전·바인딩을 유지하는 Cloudflare API로 수행한다.

## 다른 서비스

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
