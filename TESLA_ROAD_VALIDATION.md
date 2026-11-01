# 도로·Tesla 실연동 검증 기록

2026-10-31. 대상: Tesla Model Y / 롯데월드 어드벤처 부산(사용자 지정).

## 연결

- OSRM: https://flowad-roads.onrender.com (사용자 소유 Render Free)
- TESLA_COMMAND_PROXY_URL: 현재 설정 없음. 공식 command.go에서 navigation_request가 ErrCommandUseRESTAPI로 처리되므로 이 단일 목적지 명령은 Fleet REST로 전송한다. 설정이 있으면 HTTPS 프록시를 사용한다. GPS·경유지 일괄 전송과 기타 차량 명령은 지원하지 않는다.
- Tesla 인증은 Render의 기존 환경변수를 사용한다. 비밀 값을 읽거나 소스에 복사하지 않는다.
- `/tesla-check.html`에서 로그인, 차량 조회·선택, 도로 검증, 목적지 전송, 사용자 차량 확인을 각각 수행한다.
- 실차 목적지는 부산광역시 기장군 기장읍 동부산관광로 42. 도로 검증 좌표 35.19602,129.2132는 부산관광공사 공식 페이지 지도 데이터다. OSRM 최근접 도로 스냅 거리는 28.70m로 확인했다. Tesla로는 공식 명칭과 도로명 주소를 보낸다.
- 검증 출발점은 공개 기준점인 부산시청(35.1796,129.0756)이며 차량 위치가 아니다. 차량 위치 권한은 요청하지 않는다. Tesla는 차량 위치에서 경로를 다시 계산한다.

## 판정 원칙

실제 도로 응답, API 접수, 차량 화면 반영, 사용자 확인은 별도다. 사용자 확인은 자동 차량 반영 확인으로 표시하지 않는다. 계획은 선택 차량에 묶이며 5분 유효·1회 전송이다. 시간 초과 시 자동 재전송하지 않는다. 저장소·로그에 토큰/VIN/개인 위치를 남기지 않는다.

## 진행 상태

- 대한민국 OSRM 배포와 서울·부산·제주·장거리·왕복 실제 응답: 이전 단계 통과.
- Model Y·기장 롯데월드 검증 화면 및 서버 명령: 구현, Java 28건 통과. PR #1을 main에 반영하고 Render 배포 완료(3907e5b8cac811ca2ec3b99fbbb6028a9fe82735).
- 실제 OSRM을 거친 Java 목적지 경로: 부산시청 기준 16.4km. 추천 API에서는 부산 해안 코스 55.3km / 왕복 4구간을 확인했다.
- 일부 경유지가 도로 100m 안에 없어 제외되는 후보는 다른 후보 계산을 중단시키지 않도록 NoSegment와 제공자 장애를 구분했다.
- Render ROAD_ROUTING_URL 설정 저장 완료. 기존 Tesla 인증정보 값은 조회·복사하지 않았다.
- 실제 OAuth 시작: 운영 HTTPS 검증 화면에서 Tesla 공식 로그인 페이지로 이동 확인. 사용자 로그인·권한 동의 완료, 운영 서버에서 CONNECTED 확인.
- 실제 차량 목록 조회는 지역 조회 단계에서 REGION_ENDPOINT_UNAVAILABLE로 중단됐다. 기존 코드가 HTTP 404와 412를 같은 NO_DATA로 변환하여 상태를 구분할 수 없었다. HTTP 412 사전 조건, 402 결제, 421 지역 오류를 분리하고 캐시 조회의 412만 NO_DATA로 유지한다. 원문 응답이나 인증정보는 기록하지 않는다.
- 차량 목록·내비 전송·차량 표시: 아직 미확인. 결과 확보 후 갱신한다.

## 근거

- https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens
- https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
- https://github.com/teslamotors/vehicle-command/blob/main/pkg/proxy/command.go
- https://visitbusan.net/kr/index.do?lang_cd=ko&menuCd=DOM_000000201001001000&uc_seq=1310


## 2026-11-01 파트너 등록 준비

- PR #2 배포 후 실제 지역 조회에서 HTTP 412(PRECONDITION_FAILED)를 확인했다. OAuth 로그인·동의와 API 파트너 등록은 별개다. 차량 조회·명령은 성공하지 않았다.
- 등록 도메인의 공개키 주소가 PEM 대신 일반 페이지를 반환했다. ravirgo 사이트 PR #5에서 P-256 공개키와 Content-Type을 추가했다. 운영 HTTPS에서 HTTP 200, text/plain, 공개키 DER 지문 일치를 실제 확인했다. 인증이나 쿠키 없이 식별용 User-Agent Flowad-Tesla-Partner-Setup/1.0으로 조회했다.
- 공개키 DER SHA-256: `3a6e1f167161a66fc2e3941ff2da908ed8f0cbb5d38c9e105fca59bd097ad3c9`. 개인키는 저장소 밖 로컬 `~/Library/Flowad/tesla/private-key.pem`에 0600, 상위 폴더 0700으로 보관한다. 서버·브라우저·채팅으로 복사하지 않는다.
- `TeslaPartnerRegistration`은 기본 비활성이다. 운영자가 Render의 `TESLA_REGISTER_PARTNER=true`로 켠 경우에만 시작 시 한 번 실행한다. 공개 HTTPS 키와 포함된 예상 키의 일치를 먼저 확인하고, Render의 기존 앱 인증정보로 파트너 토큰을 받아 북미·아태 API에 `ravirgo.com`을 등록한다. 이 코드에는 공개 관리자 HTTP 엔드포인트가 없다.
- 기존 공개키 조회가 200이면 일치 여부만 확인하고 등록을 보내지 않는다. 404/412일 때만 등록을 시도한다. 오류 시 반복 요청하지 않으며 상태 코드와 고정 결과만 로그에 남긴다. 원문·토큰·앱 비밀 값은 남기지 않는다.
- 등록 후 즉시 `TESLA_REGISTER_PARTNER`를 제거하거나 false로 저장한다. 이후 재시작에 등록이 재실행되지 않도록 해야 한다. 가상키 페어링, 개인키 업로드, 프록시 배포, 결제 한도 변경은 수행하지 않는다.
- 서버 파트너 등록은 아직 활성화·실행하지 않았다. 공개키 확인 → 등록 활성화 → 실제 지역/차량 조회 → 사용자 지정 목적지 전송 → 실제 차량 화면 확인 순으로 진행한다.

- 승인 후 PR #3 배포(ffe926d)에서 공개키 사전 검사·파트너 토큰 발급은 통과했다. 기존 키 조회는 HTTP 403으로 중단되어 등록 POST는 전송하지 않았다(KEY_LOOKUP_HTTP_403). 등록 플래그는 false로 되돌렸다. 응답 원문 없이 미등록·범위 부족 등 고정 오류 분류를 추가하고, Tesla의 SEC1 16진수 공개키와 PEM을 비교하도록 보완한다.

- PR #4 배포(c9e333c)에서도 키 조회 HTTP 403_UNCLASSIFIED로 중단했다. 등록 POST는 미전송이다. 개발자 앱 화면에서 프로필·차량 정보·차량 명령 범위가 이미 승인되어 있음을 읽기 전용으로 확인했다. 계정 관리용 파트너 토큰에 openid/user_data를 포함하도록 보완한다. 사용자 OAuth 범위, 앱 승인 설정, 위치·충전 범위와 결제 한도는 변경하지 않는다.

- PR #5 배포(ff1565c)에서도 기존 키 조회가 403_UNCLASSIFIED였다. 운영자의 초기 등록 승인을 받은 작업에 한해, 공개키가 일치하고 기존 키 조회가 403 미분류/미등록인 경우 초기 등록 POST를 진행하도록 변경한다. 이는 등록 이전 일반 API 조회가 차단되는 경우를 처리한다. 기존 키 조회가 200이면 교체하지 않으며 명시적 범위 부족은 중단한다. 최초 등록 POST의 실제 결과는 후속 확인한다.

- 2026-11-01 12:58 KST 초기 등록 POST와 재조회 결과 REGISTERED_AND_VERIFIED를 확인했다(de1ba94, Render dep-dbjbgr95efls73drtu6g). 공개키 DER/SEC1 일치 검증을 통과했다. 이후 TESLA_REGISTER_PARTNER=false 저장과 실제 저장 값 false를 확인했다.
- 사용자 OAuth 재연결은 성공했으며 차량 조회는 REGION_MISMATCH_OR_UNCONFIRMED에서 중단했다. 지역 API 주소의 끝 슬래시 정규화와 고정 지역 오류 구분을 보완한다. 실제 차량 목록과 명령은 아직 미검증이다.
