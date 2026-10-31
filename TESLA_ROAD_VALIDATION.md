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

