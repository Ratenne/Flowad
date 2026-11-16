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

### Tesla 브라우저 레이아웃

Tesla 공개 개발자 문서에서 차량 브라우저용 권장 CSS는 확인되지 않았다. 중앙 화면의 크기와 방향은 모델, 생산 시기, 트림에 따라 다르다. Flowad는 현재 브라우저 창의 CSS 픽셀 너비, 높이, 비율로 레이아웃을 결정한다. [Tesla 개발자 문서](https://developer.tesla.com/en_sg) · [Tesla 차량별 매뉴얼](https://www.tesla.com/ownersmanual/)

| 중앙 화면 유형 | 브라우저 재현 크기 | 레이아웃 |
| --- | --- | --- |
| Model 3/Y 15–15.4인치 가로형 | 1920×1200, 1254×784 (DPR 1.53) | 코스 열과 지형을 나란히 배치 |
| Model S/X 후기형 가로 화면 | 2200×1300 | 코스 열과 지형을 나란히 배치 |
| Model 3/Y 16인치 가로형, Cybertruck 18.5인치 가로형 | 2560×1440, 2650×1440 | 코스 열 너비를 제한해 지형을 넓힘 |
| Model S/X 초기형 세로 화면 | 1200×1920 | 코스 카드 세 장을 한 줄에 배치하고 지형은 아래에 표시 |
| 작은 가로형 브라우저 창 | 773×601, 1280×480 | 코스와 지형을 나란히 표시 |

표의 크기는 브라우저 테스트 입력이다. Tesla가 공개한 제품 정보는 화면 크기와 방향 확인에 사용했다. 표시 배율과 차량 UI가 차지하는 영역에 따라 CSS 뷰포트는 달라질 수 있다. [Model 3](https://www.tesla.com/model3) · [Model Y 디스플레이](https://www.tesla.com/en_gb/blog/introducing-new-model-y-performance) · [Model S/X 디스플레이](https://www.tesla.com/support/videos/watch/displays-meet-your-model-s) · [초기형 Model S 터치스크린](https://www.tesla.com/sites/default/files/tesla-model-s.pdf) · [Cybertruck](https://www.tesla.com/ko_kr/cybertruck)

창 너비 740 CSS px, 높이 420 CSS px, 너비 대 높이 6:5를 기준으로 세로 배치와 2열 배치를 전환한다. 2열의 코스 열에는 최소·최대 너비를 두고, 7:4 이상에서는 지형에 더 많은 공간을 배정한다. 주요 버튼은 높이 48–56 CSS px를 확보한다. 날씨, 충전, 코스 선택, 지형 재생 아이콘은 앱에 포함된 SVG를 사용한다. 실제 차량 브라우저의 표시와 조작감은 실차 확인이 필요하다.

## 2. 차량 순정 내비게이션 경로

현재 위치 주소는 Pleos Android 앱의 **차량 상태 · 현재 주소 조회**에서 NaviHelper의 `CurrentLocationInfo.address`를 사용한다. 이 필드는 현재 주소 문자열이며 건물명과 도로명주소가 별도로 제공되지 않는다. [Pleos NaviHelper](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/navi-helper/ai.pleos.playground.navi.data/current-location-info/entry)

웹은 브라우저 GPS 또는 동의한 Tesla 차량 좌표로 도로명주소 서비스를 조회한다. 주소를 조회하지 못해도 코스 추천은 계속한다. 주소 확인을 위해 좌표를 주소기반산업지원서비스로 전송하며 Flowad 서버에 저장하지 않는다.

메인의 **사용 환경**에서 PC·모바일은 이 기기의 브라우저 위치를, Tesla 차량은 선택한 차량 위치를 기본 조회한다. 일반 웹 브라우저만으로 차량 내 실행을 확정하지 않으며 사용자가 환경을 지정한다. 환경 선택값만 브라우저에 보관하고 좌표·차량 식별자는 보관하지 않는다. 기기와 차량 좌표는 같거나 다를 수 있으며, 좌표가 같아도 출처와 측정 시각을 따로 표시한다. 조회 실패를 이유로 다른 출처로 자동 전환하지 않는다.

브라우저 위치는 추가 측정 후 오차가 100m 초과~1km 이내이면 **대략적인 위치**로 표시해 추천한다. 1km 초과일 때는 실제 오차를 표시하고 사용자가 **대략적인 기기 위치로 추천**을 선택해야 사용한다. 이 명시적 선택은 측정 후 60초 이내만 허용한다. 대략적인 위치는 주소 조회와 주소 지도에 사용하지 않는다. 권한 거부·위치 없음·오래된 위치에는 이 선택지를 제공하지 않는다.

Tesla 위치 조회는 인증 세션의 마지막 선택 차량을 복원한다. 차량 목록을 갱신해도 접근 가능한 동일 차량의 선택을 유지하며, 목록에서 사라진 차량이나 처음 보이는 다른 차량을 임의로 선택하지 않는다. 복원할 선택이 없으면 차량 목록을 열고, 사용자가 선택하면 차량 위치 조회를 계속한다. Workers의 마지막 차량 식별자는 기존 암호화 세션에, Java는 서버 세션 메모리에만 보관한다. 연결 해제·세션 만료 후에는 새로 선택해야 한다. 위치 사용 동의와 online 확인은 계속 필요하며, 차량 위치는 `stale`이 아니고 측정 시각이 15분 이내인 데이터만 사용한다.

주소 조회와 공식 지도에는 **지도제공 검색 API 승인키**인 `JUSO_MAP_API_KEY`를 사용한다. 실제 웹/API가 실행되는 Cloudflare Worker `flowad-api-stage2`의 Secret으로 설정한다. Spring Boot를 직접 실행하는 경우에는 해당 서버의 같은 이름 환경 변수로 설정한다. Render의 도로 전용 서비스 `flowad-roads`에는 설정하지 않는다. 서비스 URL은 사용자가 접속하는 Flowad 주소로 등록한다. 일반 주소 검색/주소→좌표 API 승인키와 혼용하지 않는다. [공식 신청 안내](https://www.data.go.kr/data/15096716/openapi.do)

`POST /api/location/address`는 WGS84 위도·경도를 EPSG:5179로 변환하고 공식 지도 SDK가 사용하는 `https://business.juso.go.kr/addrlink/addrMapData.do`에 `searchType=1`로 요청한다. JSONP/XML을 실행하지 않고 파싱해 첫 도로명주소를 `{label,type:"ROAD_ADDRESS",source:"JUSO_MAP"}`으로 반환한다. 주소는 제공자의 좌표 검색 결과이며 건물 내부 위치를 증명하지 않는다. 별도 주소 DB·`ADDRESS_DB`·`ADDRESS_INDEX_PATH`는 사용하지 않는다. 이전 주소 인덱스 생성 스크립트는 현재 API와 연결되지 않는다.

주소 조회에는 좌표가 주소기반산업지원서비스로 전송된다. Flowad는 주소·좌표·승인키를 로그나 DB에 저장하지 않는다. 조회 실패 시 좌표 기반 추천은 계속한다. 결과 없음/국내 범위 밖은 204, 키 미설정·승인 거부·서비스 오류는 503이며 `X-Flowad-Status`로 구분한다. 외부 요청은 3초 내 종료하고 응답은 256KiB 이내만 사용한다.

공식 SDK의 요청·응답 형식과 유효하지 않은 테스트키의 실제 `E0001` 응답은 2026-11-16에 확인했다. 같은 날 사용자가 이전 주소 변경의 운영 배포와 유효 승인키의 실제 주소 조회 검증을 완료했다고 확인했다(사용자 보고). 이번 차량 선택 복원·사용 환경·대략적인 위치 선택 변경은 로컬 목 테스트 범위이며 별도 운영 검증이 필요하다. 이 엔드포인트는 지도 SDK의 프로토콜이므로 SDK 변경 시 호환성 확인이 필요하다. **설정 → 여정 → 공식 주소 지도 확인**은 기존 지도 스크립트로 같은 승인키를 사용한다.

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

콜백은 등록된 HTTPS URL의 `/api/tesla/callback`이어야 한다. HTTPS 인증서와 TLS 종료는 별도로 구성해야 하며, 애플리케이션에서 요청을 HTTPS로 인식해야 한다. 현재 로컬 HTTP 또는 인증서 미구성 상태로는 로그인하지 않는다. 개발자 앱 인증정보가 설정돼도 이 프로젝트의 TLS 및 외부 접근 구성은 자동으로 만들어지지 않는다. 역방향 프록시를 사용할 경우 신뢰 경계와 callback 접근 로그에서 코드·위치·토큰 제거, 세션/CSRF 보안 검토가 필요하다. 실제 인증을 사용자가 직접 진행하고, 차량 목록과 배터리 캐시를 버튼으로 수동 조회한다. 브라우저 GPS와 Tesla 차량 위치는 사용자가 각각 조회한다. 브라우저 권한을 거부해도 차량 위치를 수동으로 조회할 수 있으며 오프라인 차량을 깨우지 않는다. Tesla에서 반환하는 `est_battery_range` 단위는 현재 마일 가정으로 km 변환하고 있어 실차 확인이 필요하다. 로그인 상태는 서버 메모리 세션(30분)으로만 유지된다. 연결 해제는 로컬 삭제이며 Tesla 계정 동의 철회는 별도다.

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
