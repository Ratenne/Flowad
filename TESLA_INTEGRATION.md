# Tesla Fleet API 조사 및 3단계 진행 상태

후속 구현과 실제 검증 진행은 [도로·실차 검증 기록](TESLA_ROAD_VALIDATION.md)을 참조한다. 아래는 이전 단계 기록이다.

2026-10-30 기준. OAuth 서버 및 차량 조회는 구현하고 목 테스트했다. 실제 Tesla 인증·조회는 미검증이다. 내비 전송과 프록시는 구현되지 않았다. 현재 코스는 실제 도로 기반이 아니며 차량에 전송할 수 없다. 인증정보를 소스코드에 넣지 않는다.

## 공식 문서에서 확인한 내용

- 개발자 계정은 이메일 인증과 MFA, 앱 생성 및 필요한 범위 등록이 필요하다. 공개키를 등록 도메인의 `/.well-known/appspecific/com.tesla.3p.public-key.pem`에서 HTTPS로 제공하고, 각 사용 지역에 파트너 등록이 필요하다. 개인키는 공개하지 않는다. [시작하기](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api), [파트너 등록](https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints)
- 한국은 아시아태평양(중국 제외) Fleet API 기본 주소 `https://fleet-api.prd.na.vn.cloud.tesla.com`에 해당한다. 대한민국은 결제 및 한도 변경 가능 국가 목록에 있다. 해당 차량의 실계정 접근과 승인 여부는 확인하지 않았다. [지역](https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries)
- 고객 인증은 authorization code, 무작위 state, 등록된 redirect URI와 서버 측 코드 교환이 필요하다. 갱신에는 `openid offline_access`가 필요하고 refresh token은 교환 후 새 값을 저장해야 한다. 등록 도메인과 HTTPS callback에 대한 실제 승인 요건 및 PKCE 지원 여부는 계정 설정과 문서를 추가 확인한다. [서드파티 토큰](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens)
- 후보 최소 범위는 `openid`, `offline_access`, `vehicle_device_data`, 내비 전송의 `vehicle_cmds`; Tesla 차량 위치를 실제로 사용하면 별도 동의로 `vehicle_location`. 해당 명령별 정확한 권한 및 앱 승인 범위는 Tesla에서 추가 확인한다. `user_data`, `vehicle_charging_cmds`는 현재 요구만으로 요청하지 않는다. [범위](https://developer.tesla.com/docs/fleet-api/authentication/overview)
- 차량 목록은 `/api/1/vehicles`. `vehicle_data_cached`는 차량을 깨우지 않으나 오래될 수 있고 위치가 없다. 실시간 데이터 반복 조회는 권장되지 않으며 위치 정보는 추가 조건과 동의가 필요하다. 공유 차량의 privacy 설정은 위치를 제한할 수 있다. [차량 API](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints)
- 명령은 일반적으로 차량에 가상키 페어링과 서명이 필요하며 Tesla Vehicle Command Proxy를 이용할 수 있다. 일부 차량은 예외다. Proxy 배포·TLS·개인키 관리는 아직 구성하지 않았다. [명령](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands), [가상키](https://developer.tesla.com/docs/fleet-api/virtual-keys/overview), [공식 프록시](https://github.com/teslamotors/vehicle-command)
- 공식 문서에는 `navigation_request`, `navigation_gps_request`, `navigation_waypoints_request`가 기술되어 있으나 이 조사에서 GPS/경유지의 정확한 요청 본문, 최대 개수, 모델·펌웨어별 지원, 순서·최종 복귀 반영 확인 방법을 확보하지 못했다. 공식 프록시 저장소의 현재 공개 command.go 검색에서도 경유지 명령 처리 확인에 실패했다. Tesla의 확인과 공식 버전 검증 전까지 요청 본문을 추측해 보내지 않는다. [명령 문서](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands), [프록시 소스](https://github.com/teslamotors/vehicle-command/blob/main/pkg/proxy/command.go)
- 종량제이며 월 $10 할인, 기본 결제 한도 0, HTTP 500 미만은 과금 대상이라고 명시한다. 차량·계정당 분당 실시간 데이터 60, 깨우기 3, 명령 30 제한이 있다. 상품별 단가와 세금, 실제 계정의 결제 한도는 실행 전에 확인한다. [요금과 제한](https://developer.tesla.com/docs/fleet-api/billing-and-limits)

## 구현된 범위 및 로컬 설정

Tesla 앱의 client ID, client secret, 등록된 HTTPS callback을 서버 환경 변수 `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `TESLA_REDIRECT_URI`로 설정한다. 예를 들어 callback 경로는 `https://등록도메인/api/tesla/callback`이다. 값은 채팅이나 소스코드에 넣지 않는다. Spring 서버에 신뢰 가능한 HTTPS 인증서를 설정해야 하며, 기본 `http://localhost:8080`에서는 Tesla 연결이 차단된다. 이 프로젝트는 도메인·인증서 발급, 프록시와 배포를 구성하지 않는다. 도메인 설정 없이 환경 변수만 지정해도 실제 인증이 되는 것은 아니다.

인증 시작은 state를 5분간 세션에 보관하고 callback에서 일회성 검증 후 서버에서 code를 교환한다. 토큰과 VIN 매핑은 서버 세션 메모리에만 있으며 세션 만료 30분, 연결 해제 또는 프로세스 종료 시 사라진다. refresh token은 서버 응답으로 회전하며 저장소가 없어 재시작하면 재인증해야 한다. 연결 해제는 로컬 세션 삭제이며 Tesla 서버의 동의 철회가 아니다. Tesla 계정의 동의 관리에서 별도 철회해야 한다. 세션 쿠키는 Secure, HttpOnly, SameSite=Lax이며 CSRF 토큰 검증과 HTTPS를 요구한다. 운영 적용 전에 HTTPS 종료 위치, 프록시 로깅 및 세션/CSRF 보안 검토가 필요하다.

차량 목록은 수동 조회하고 VIN 대신 세션 임시 ID를 브라우저에 전달한다. 목록의 현재 구현은 첫 페이지 100대만 표시한다. 배터리·잔여 예상 주행거리는 캐시 데이터로 수동 조회하며, Tesla 응답의 주행거리 단위를 마일로 가정해 km로 환산하므로 실차 검증 필요. 캐시는 원래 시각이 없거나 15분 이상이면 오래된 것으로 표시한다. 위치는 선택 동의와 별도 수동 조회이며, 매번 차량이 online인지 확인하고 절전·오프라인을 깨우지 않는다. 차량에 정확한 위치 공유 표시가 나타날 수 있다. 위치와 차량 데이터는 파일·DB에 저장하지 않으며 화면 및 요청 메모리에서 사용한다. Tesla와 기존 Open-Meteo로 전달되는 정보는 각 서비스 정책이 적용된다.

내비 어댑터 `send`는 추정 경로를 포함한 모든 경로에 `UNSUPPORTED`를 반환하고 HTTP 명령을 전혀 보내지 않는다. 경유지 명세 및 실제 도로 탐색 미확인 상태에서 추정 경로를 차량 안내에 사용할 수 없다.

## 남은 구현 및 실차 검증 체크리스트

1. 테스트 도메인 및 Tesla 승인 후 OAuth 실제 통합 검증, 동의 철회 및 HTTPS/세션 보안 검토를 수행한다.
2. HTTPS 등록 도메인과 Tesla 개발자 앱 승인, redirect URI 등록 및 공개키 호스팅을 준비한다. DNS 변경이나 배포는 별도 요청 없이 수행하지 않는다.
3. 파트너 등록, 한국 지역 설정, 비용·호출 한도 및 차량 소유자 권한과 가상키 페어링을 확인한다. 개인키는 안전한 별도 저장소에 보관한다.
4. 실제 차량 목록, 캐시 상태와 위치 조회, 단위 및 세부 권한을 검증한다. 목록 페이지 처리와 실제 API 오류 유형을 추가로 확인한다. 자동 깨우기와 주기적 조회는 하지 않는다.
5. Tesla 공식 지원팀/문서에서 경유지 명령 요청 스키마, 지원 차종·펌웨어·프록시 버전, 응답과 반영 확인 방법을 확인한 다음 어댑터와 중복 방지를 구현한다. 현재 2단계 전체 왕복 경로는 실제 도로 탐색이 아니라 추정이다.
6. 실차 테스트 전 테스트 차량과 전송할 코스, 비용과 정차 상태를 사용자에게 제시해 실행 조건을 확인한다. 명령 수락·차량 응답·실제 내비 반영은 각각 기록한다.

## 검사

`cd backend; mvn test` 및 `node scripts/test-engine.mjs`, `node scripts/test-terrain.mjs`. 목 서비스로 state, 로그인 거부, 토큰 갱신·철회, 차량 없음, 절전·위치 없음·권한 부족, 데이터 노후 상태를 검증했다. 실제 OAuth, Tesla API와 실차 명령은 수행하지 않았다. HTTP 수준 OAuth 통합·브라우저·로그 캡처, 실제 명령 응답 및 지연 검사는 미완료다.
