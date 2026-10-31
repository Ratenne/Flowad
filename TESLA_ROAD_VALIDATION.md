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
- Model Y·기장 롯데월드 검증 화면 및 서버 명령: 구현, 목 테스트 후 배포 예정.
- 실제 OAuth·차량 목록·내비 전송·차량 표시: 아직 미확인. 결과 확보 후 갱신한다.

## 근거

- https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens
- https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
- https://github.com/teslamotors/vehicle-command/blob/main/pkg/proxy/command.go
- https://visitbusan.net/kr/index.do?lang_cd=ko&menuCd=DOM_000000201001001000&uc_seq=1310

