# Pleos Connect 4단계

2026-10-31. NaviHelper 3.0.5 / Vehicle 2.3.2, minSdk 28, compile/target SDK 34, JDK 17, AGP 8.7.3, Kotlin 2.0.21, Gradle 8.9. Pleos AVD 2.1.0 ARM64, RAM 4GB, Cold boot. 에뮬레이터 Navi Service는 3.0.4다.

## 웹에서 차량까지

추천 API가 코스마다 5분 유효 HMAC-SHA256 티켓을 발급한다. 티켓에는 그 응답의 경유지 목록·순서·상태를 넣는다. 웹은 좌표를 별도로 구성해 전달하지 않고 티켓만 최상위 HTTPS WebView 브리지로 보낸다. 앱은 고정된 HTTPS `/flowad/api/navigation/resolve`에 POST하고, 서버가 서명·버전·만료를 검증한 원래 경로를 사용한다. 재계산으로 코스를 바꾸지 않는다.

서명키는 서버에만 존재한다. `NAVIGATION_TICKET_SECRET`에 32바이트 이상의 난수 키를 Base64로 설정할 수 있다. 미설정 시 시작마다 임시 키를 생성하므로 재시작하면 기존 티켓은 무효화된다. 여러 인스턴스를 사용할 때는 같은 키를 설정해야 한다. Pleos client secret과는 별도다. 티켓은 암호화가 아니므로 URL·로그·공개 문서에 넣지 않는다. 재사용은 5분 동안 가능하지만 매번 앱의 사용자 확인과 현재 주행 제한 확인이 필요하다. 서버 API는 차량 명령을 실행하지 않는다.

앱은 `https://ravirgo.com/flowad/`만 내비게이션하고, HTTPS 정확한 출처·포트·경로와 최상위 프레임을 검사한다. HTTP·파일 접근·혼합 콘텐츠는 차단한다. CSP는 외부/인라인 스크립트와 iframe을 제한한다. 같은 출처의 서버 자체가 침해되는 상황까지 출처 검사로 방어할 수는 없으므로 네이티브에서 경로 확인과 전송 확인을 별도로 받는다. 릴리스 WebView 디버깅은 꺼져 있다.

## 경로·안전·복원

전체 ORIGIN → 경유지들 → RETURN 순서를 최대 두 경유지와 한 목적지씩 나눈다. 지점을 누락하거나 임의로 정렬하지 않는다. 각 구간은 순정 내비가 다시 탐색하므로 도로선과 실제 통행 가능성을 보장하지 않는다. 경로 구조·좌표·이름·개수를 검증하고 최대 1,000개 지점으로 앱 입력 크기를 제한한다.

요청 후 목적지와 경유지 좌표를 조회해 대조한다. 서비스 3.0.4는 새 완료 이벤트 대신 `onRouteEnded`를 보내므로 두 완료 콜백을 처리한다. 현재 AVD는 경유지 좌표를 `(0,0)`으로 반환하는 경우가 있어 자동 검증할 수 없다. 이 경우 경유지 개수가 일치할 때만 사용자에게 차량 내비 화면의 경유지 순서를 직접 확인하도록 요청하고, 자동 검증과 사용자 확인을 구분한다. 유효한 다른 좌표가 반환되거나 지점 수가 다르면 중지한다.

실제 도착 콜백에는 요청 ID·좌표가 없어 사용자 도착 확인을 추가로 요구한다. 앱이 도착 이벤트를 임의 생성하지 않는다. 시뮬레이션은 `androidTest`에서만 주입하며 릴리스에 포함되지 않는다. 실제 서비스의 도착 이벤트 발생과 테스트 대역 성공은 별개다.

CarUxRestrictions를 사용하고, 제한·미확인·연결 실패 상태는 조작을 막는다. 웹의 주행 미리보기는 안전 신호로 사용하지 않는다. 저장 경로는 비공개 저장소에 24시간까지 보관하며 복원은 항상 PAUSED다. 도착 확인된 구간은 다음 구간으로 체크포인트를 남기고, 사용자가 확인하기 전에는 다시 전송하지 않는다. 웹 오류 재시도와 렌더러 종료 복구 시에도 경로는 일시 중지한다.

## 차량 상태

`PleosVehicleAdapter`는 실제 SDK capability가 READ/READ_WRITE인 경우에만 SOC를 읽는다. 위치는 NAVI_ROUTE 권한의 NaviHelper 위치 조회 응답을 사용한다. `VehicleReading` 필드명은 Tesla Reading과 동일하며, 읽을 수 없는 값은 null로 남긴다. 잔여 주행거리는 확인된 API가 없어 null이고 웹 수동 입력을 안내한다. 실차·배터리 잔여거리 지원을 보장하지 않는다. 차량 상태는 현재 네이티브 조회 화면에서 제공하며 웹으로 자동 전송하지 않는다.

## 실행과 검증

```sh
scripts/pleos-gradle.sh :app:assembleDebug :app:testDebugUnitTest
scripts/pleos-emulator.sh
```

기존 설치 경로는 `~/Library/Android/sdk`, JDK는 `~/Library/Flowad/toolchains/jdk-17.0.21+9/Contents/Home`다. 앱과 테스트 APK를 설치한 뒤 `adb shell am instrument -w kr.gyeollon.pleos.test/androidx.test.runner.AndroidJUnitRunner`로 실행한다. 주행 제한 테스트는 `externalRestriction=true`와 Virtual Console의 P→D 전환이 필요하다. 내비 시뮬레이션 테스트는 `simulatedArrival=true`, 실제 도착 대기 테스트는 `waitArrival=true`로 별도 실행한다. 기본 테스트의 생략 항목을 성공으로 세지 않는다.

백엔드 티켓 변조·만료·다른 키 거부 및 원본 경로 일치 테스트와 기존 백엔드 테스트를 실행했다. Android 단위 테스트, 에뮬레이터 응답 파싱·출처 차단·복원 테스트를 실행했다. 자세한 최종 결과는 배포 검증 기록에 남긴다. 실제 차량·지역별 앱 심사·실제 도착 콜백·NAVI_CUSTOM_MAP 화면 전환은 검증 완료로 주장하지 않는다.

공식 문서: [SDK 초기화](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/initialization-and-release), [경유지](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/waypoint-settings), [주행 제한](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/driver-distraction-guideline), [앱 보안](https://document.pleos.ai/en/docs/pleos-only/app-registration-guide/app-security-guide).
