> 후속 요청: 유료 생성을 보류한 뒤 사용자가 Render Free 배포를 승인했다. 최신 도로 서버 진행·실측은 [무료 배포 기록](deploy/ROADS_FREE.md)을 참조한다.

# 도로 계산 및 Tesla 목적지 전송

2026-10-31 구현. 실제 계정 인증·차량 전송·배포는 아직 수행하지 않았다.

## 현재 동작

- ROAD_ROUTING_URL을 설정하면 OSRM driving 서비스로 출발→모든 경유지→복귀 전체 도로를 계산한다. 각 입력점의 도로 스냅 100m 이내, 구간 수·거리·시간·좌표·구간 양끝을 검증한다. 도로 서버 실패 시 추정으로 성공 처리하지 않는다. 이는 OSM 도로 연결 검증이며 현재 통행·사유지 진입 보증이 아니다.
- 휴대폰 코스 상세에서 `전송할 경로 확인` → 목적지 선택 → 전송. 경로 확인 시 출발·경유지 좌표는 설정한 도로 서버로 전송된다. 로그인 시 `내비 목적지 전송 권한 요청`을 선택해 vehicle_cmds를 요청한다. 기존 연결은 해제 후 재로그인한다. 실제 토큰의 scope에 vehicle_cmds가 있어야 전송한다.
- 서버가 도로를 재계산하고 5분 유효한 차량 종속 계획을 만든다. 한 계획은 선택한 목적지 1개에 한 번만 사용한다. 중복 클릭, 차량 변경, 만료, 추정 경로를 차단한다. API 실패·타임아웃은 자동 재전송하지 않는다.
- navigation_request는 Tesla 공식 command.go에서 REST 예외로 처리된다. 따라서 이 한 명령에는 별도 서명 프록시 없이 Fleet REST에 요청할 수 있다. TESLA_COMMAND_PROXY_URL을 지정하면 해당 HTTPS 프록시를 통해 요청한다. 다른 차량 명령은 이 경로로 허용하지 않는다.
- 전송은 현재 차량 목적지를 바꿀 수 있다. 경유지 전체 일괄 등록과 특정 도로선 강제는 미지원이다. 공식 프록시 main의 navigation_gps_request/navigation_waypoints_request 처리 부재로 이번 구현에 추측 스키마를 추가하지 않았다.
- REQUEST_ACCEPTED는 Tesla API 접수, UNKNOWN은 결과 불명, FAILED는 거부다. 차량 화면 일치 버튼은 USER_CONFIRMED 사용자 확인일 뿐 자동 차량 반영 검증이 아니다. 다음 지점은 정차·도착 후 새 계획으로 선택한다.

## Render 설정

확인한 기존 변수: TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_REDIRECT_URI. 비밀 값은 읽거나 복사하지 않았다.

1. `deploy/osrm/Dockerfile`로 대한민국 OSM 도로 서버를 만들고 완료된 HTTPS 주소를 기존 Flowad의 ROAD_ROUTING_URL에 지정한다. `deploy/render-roads.yaml`은 **유료 standard 계획 제안**이며 적용하지 않았다. 지도 전처리 빌드와 런타임 메모리는 실제 빌드·부하 검사로 확인해야 하며 아직 보장하지 않는다. 지도 업데이트는 새 이미지를 빌드해 배포한다.
2. 무료 공개 OSRM 데모는 테스트 정책·가용성·좌표 전송을 확인한 단발 검증에만 사용하고 운영 URL로 지정하지 않는다.
3. Render 신뢰 프록시에서 TLS가 종료되면 SERVER_FORWARD_HEADERS_STRATEGY=native 적용 전 ingress가 외부 Forwarded/X-Forwarded-*를 덮어쓰는지 확인한다. HTTPS_REQUIRED를 제거하지 않는다.
4. 승인된 Tesla 개발자 앱의 redirect URI와 vehicle_cmds 권한을 확인하고 실제 OAuth를 진행한다. 토큰·개인키를 브라우저 코드나 Git에 넣지 않는다.
5. 기존 Dockerfile로 Flowad를 배포한다. 이 변경은 아직 push/운영 배포하지 않았다.

## 실차 검증 기록표

아래 항목은 테스트 차량 소유자가 정차 상태에서 실제로 수행하고 결과를 기록해야 한다. 목 테스트를 통과해도 실차 통과로 기재하지 않는다.

| 항목 | 결과 |
|---|---|
| 차종·MCU·차량 펌웨어·모바일 앱 버전 | 미기록 |
| HTTPS callback/state 검증 및 scope vehicle_cmds | 미실행 |
| 차량 목록과 선택 차량 이름 | 미실행 |
| 도로 서버 왕복 구간·스냅·마지막 복귀 지점 | 미실행 |
| 가까운 목적지 1개 전송 후 API 상태·차량 이름/좌표 일치 | 미실행 |
| 다음 경유지와 복귀 지점 각각 수동 전송 | 미실행 |
| 차량 절전·권한 거부·중복·응답 유실 처리 | 목 테스트 / 실차 미실행 |
| 전체 경유지 일괄 등록 | 미지원 |

응답 원문·VIN·토큰·정확한 자택 위치는 기록이나 스크린샷에 남기지 않는다.

## 근거

- https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
- https://github.com/teslamotors/vehicle-command/blob/main/pkg/proxy/command.go (`navigation_request` → ErrCommandUseRESTAPI)
- https://project-osrm.org/docs/v5.24.0/api/ (Route, Waypoint, steps geometry)
- https://download.geofabrik.de/asia/south-korea.html

검증 결과: Java 23건 통과(실제 수는 surefire 보고서 참조), 엔진·지형·배터리 검사 통과. 공개 OSRM의 서울 시청→강남역 예시 1구간에서 code=Ok, 도로 스냅 약 56m/2m 응답을 확인했다. 해당 실제 응답을 새 OsrmRoadProvider.parse에 재생하여 스냅·구간·geometry 검증 통과도 확인했다. 사용자가 유료 서버 생성을 보류해 운영 서버·실차 검증은 미수행.

검증 명령: `mvn -f backend/pom.xml test`, `node --check dist/app.js`, `node scripts/test-engine.mjs`, `node scripts/test-terrain.mjs`, `node scripts/test-battery.mjs`.
