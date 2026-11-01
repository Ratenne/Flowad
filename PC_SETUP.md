# PC 확인 및 외부 서비스 준비 (2026-10-30)

## 현재 상태

- 웹·백엔드는 로컬 실행 가능. 기본은 외부 도로 호출 없는 예시 코스와 추정 왕복.
- 차량 자체 내비게이션 경로 요청을 목표로 한다. 타사 지도 길찾기 API 연결은 제거했으며 현재 전체 왕복은 추정이다.
- Tesla OAuth 및 조회는 목 테스트만 했으며 이 PC에 환경 변수가 없다. 실제 인증·차량 조회를 수행하지 않았다.
- Pleos Android의 최신 구현·재실행·검증 한계는 [4단계 기록](PLEOS_STAGE4.md)을 확인하세요.
- 충전 평가는 실제 도로 왕복이 있을 때만 계산한다. 제공자 미연결로 충전소는 가상 목 데이터이며, 이탈 도로거리·호환·출력·상태는 확인하지 못한다. 실제 충전소 추천은 미완료다.

## 1. 로컬 웹 확인

JDK 17 및 Maven 필요. PowerShell에서:

```powershell
cd C:\Users\user\Documents\ChatGPT\flowad\backend
mvn spring-boot:run "-Dspring-boot.run.arguments=--server.port=8081 --server.address=127.0.0.1"
```

브라우저 `http://localhost:8081/`에서 서울 체험 또는 위치 허용 후 추천을 확인한다. 현재 기본 모드는 추정 경로이며 실제 도로·차량 안내가 아니다. 위치 권한은 사용자가 직접 허용한다. 종료는 실행 창의 Ctrl+C. 8080에 다른 서버가 있다면 8081을 사용한다. 실제 Tesla 인증에는 HTTPS가 필요하므로 이 HTTP 주소로는 인증이 안 된다.

## 2. 차량 순정 내비게이션 경로

타사 지도 길찾기 API를 사용하지 않는다. 서버의 `RoadProvider`는 현재 목 추정만 제공한다. Tesla Fleet API는 목적지와 경유지 전달 명령을 문서화하지만, 사용자 선택 전 여러 후보의 전체 왕복 경로를 순정 내비로 탐색해 앱에 반환하는 기능은 확인되지 않았다. 명령의 요청 형식과 지원 조건도 미확인이라 전송은 차단되어 있다.

Pleos 앱은 웹 추천 티켓을 검증하고 전체 코스를 구간마다 경유지 최대 두 개와 목적지로 나눠 순차 전송한다. NaviHelper 요청·결과는 에뮬레이터에서 확인했으며, 실제 도착 이벤트는 미검증이다. 내비 요청이 차량 내 경로를 변경할 수 있으므로 사용자의 명시적 요청과 UX 제한 조건을 확인해야 한다. 무조건 후보별로 순정 내비에 요청하지 않는다. 경로 길이·시간·경로선과 API 제공 범위는 실응답으로 확인해야 한다.

기존 3D 지형의 Copernicus 고도 데이터와 과거 OSM/OSRM 하이라이트는 차량 내비 지도가 아니다. 이전에 생성된 로컬 자산으로, 현재 왕복을 나타내지 않는다. 이 프로젝트는 실제 3D 도로 지도를 순정 내비에서 제공받는다고 주장하지 않는다.

## 3. Tesla 실제 인증과 캐시 조회 준비

[Tesla 앱 등록](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api), [지역](https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries), [요금](https://developer.tesla.com/docs/fleet-api/billing-and-limits)을 확인한다. 승인된 앱, 등록된 HTTPS 도메인/콜백, HTTPS 인증서, 공개키 호스팅 및 아시아태평양(중국 제외) 파트너 등록이 필요하다. 중국 생산 여부로 지역을 선택하지 않는다. 차량 목록은 고정된 북미·아태 Fleet API의 `/api/1/vehicles`에서 직접 조회한다. 지역 오류(HTTP 421)는 중단하며 다른 지역으로 자동 전송하지 않는다. 차량 목록 전에 프로필용 `/api/1/users/region`을 요구하지 않는다. 지역과 호출에 따라 비용이 발생할 수 있다. 실제 계정 한도 및 단가 확인 필요.

테스트 서버 프로세스를 사용자가 직접 시작하는 동일 PowerShell 창에서 설정한다. 값은 채팅·소스에 남기지 않는다.

```powershell
$env:TESLA_CLIENT_ID = Read-Host 'Tesla client ID'
$env:TESLA_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', (Read-Host 'Tesla client secret' -AsSecureString)).Password
$env:TESLA_REDIRECT_URI = Read-Host '등록한 HTTPS callback URL'
```

콜백은 등록된 HTTPS URL의 `/api/tesla/callback`이어야 한다. HTTPS 인증서와 TLS 종료는 별도로 구성해야 하며, 애플리케이션에서 요청을 HTTPS로 인식해야 한다. 현재 로컬 HTTP 또는 인증서 미구성 상태로는 로그인하지 않는다. 개발자 앱 인증정보가 설정돼도 이 프로젝트의 TLS 및 외부 접근 구성은 자동으로 만들어지지 않는다. 역방향 프록시를 사용할 경우 신뢰 경계와 callback 접근 로그에서 코드·위치·토큰 제거, 세션/CSRF 보안 검토가 필요하다. 실제 인증을 사용자가 직접 진행하고, 차량 목록과 배터리 캐시를 버튼으로 수동 조회한다. 위치 조회는 별도 동의와 버튼이 필요하며 차량이 오프라인이면 자동으로 깨우지 않는다. Tesla에서 반환하는 `est_battery_range` 단위는 현재 마일 가정으로 km 변환하고 있어 실차 확인이 필요하다. 로그인 상태는 서버 메모리 세션(30분)으로만 유지된다. 연결 해제는 로컬 삭제이며 Tesla 계정 동의 철회는 별도다.

## 4. Pleos 개발 환경 준비

[공식 시작 가이드](https://document.pleos.ai/en/docs/pleos-only/getting-started)에 따라 Android Studio, Android SDK API 34, Pleos Connect API 34 시스템 이미지 및 Virtual Console을 설치한다. SDK 이미지 URL은 제공받은 공식 안내에서 SDK Manager에 등록한다. 공식 가이드는 Cold boot와 RAM 4GB를 안내한다. `pleos-android/`를 Android Studio에서 열고 Gradle sync 후 에뮬레이터를 실행한다. 앱은 운영 HTTPS `https://ravirgo.com/flowad/` 화면과 같은 출처의 추천·티켓 검증 API를 사용한다. 공식 SDK 접근 승인 및 네트워크가 필요하다.

Debug·Release 빌드와 Pleos AVD의 SDK 초기화·실제 구간 요청·목적지 응답을 검증했다. 테스트에서 도착 이벤트를 주입하고 사용자 확인 후 다음 구간의 실제 전송을 확인했다. 실제 도착 신호 발생은 미검증이다. CarUxRestrictions로 주행 제한을 적용하며 안전한 웹 브리지와 경로 복원은 [4단계 기록](PLEOS_STAGE4.md), 최종 검증 범위는 [검증 기록](PLEOS_VALIDATION.md)을 참조한다. SDK 연결 성공 또는 시뮬레이션 값은 실차 검증을 의미하지 않는다.

## 5. 충전소 제공자 검토

[한국환경공단 충전소 정보 API](https://www.data.go.kr/data/15076352/openapi.do)는 충전기 위치·타입·출력·상태 등을 제공하며 무료, 실시간 갱신, 공공저작물 출처표시 제1유형, 개발 계정 1,000 요청(포털의 적용 기간과 실제 승인 한도 확인)으로 안내한다. 서비스키와 활용 신청이 필요하다. 실제 응답·Tesla 모델별 커넥터 호환성·대기시간·지도 제공자 조건은 확인하지 못했다. 실제 API 연결은 구현되지 않았다. 현재 모의 충전소는 실존 장소가 아니며 경로 좌표까지의 직선거리만 보여주고 도로 이탈거리는 미확인이다.

## 테스트

```powershell
cd C:\Users\user\Documents\ChatGPT\flowad
mvn -f backend/pom.xml test
node scripts/test-engine.mjs
node scripts/test-terrain.mjs
node scripts/test-battery.mjs
```

Pleos SDK 에뮬레이터 응답과 테스트 한계는 [검증 기록](PLEOS_VALIDATION.md)에 기록한다. 실제 Tesla API 검증 여부는 Tesla 문서를 확인한다. 확인 전에는 Tesla 내비 전송은 `UNSUPPORTED`다. 실차 명령·깨우기·배포·DNS 변경은 실행하지 않았다.

### HTTPS 서버 직접 실행 예시

등록한 콜백 도메인이 이 서버에 도달하고, 신뢰 가능한 인증서가 든 PKCS#12 키 저장소가 준비된 경우에만 사용한다. 도메인·TLS 구성은 이 프로젝트가 자동으로 변경하지 않는다. 예시의 경로는 본인 PC의 안전한 키 저장소 경로로 직접 지정한다. 개인키·암호를 저장소나 채팅에 올리지 않는다. 8081이 이미 사용 중이면 다른 포트를 선택하고 Tesla에 등록된 콜백과 외부 포트 매핑이 정확히 일치하는지 확인한다.

```powershell
$env:SERVER_SSL_KEY_STORE = Read-Host 'PKCS12 key store path'
$env:SERVER_SSL_KEY_STORE_TYPE = 'PKCS12'
$env:SERVER_SSL_KEY_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Key store password' -AsSecureString)).Password
# 앞 절의 TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_REDIRECT_URI도 이 창에서 설정
cd C:\Users\user\Documents\ChatGPT\flowad\backend
mvn spring-boot:run "-Dspring-boot.run.arguments=--server.port=8443"
```

앱 등록 도메인과 실제 TLS 인증서·콜백 URL이 일치하고 사용자 브라우저 및 Tesla가 콜백에 접근할 수 있어야 한다. 로그 프록시를 거치는 경우 해당 프록시의 URL 쿼리 기록을 끈다. 위 설정은 배포·공개 노출을 자동화하지 않는다.
