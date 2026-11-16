# Pleos Connect 4단계 검증 기록

2026-10-30 기준. 4단계 전체는 미완료다. **Android 실제 빌드와 Pleos 에뮬레이터 실행, 실제 경로 요청은 검증했다. 실제 도착 콜백과 다음 구간 전송은 검증하지 못했다.** 앱 마켓 심사를 받은 상태가 아니다.

## 설치한 환경

- JDK 17.0.21: `~/Library/Flowad/toolchains/jdk-17.0.21+9/Contents/Home`
- Gradle 8.9 Wrapper, AGP 8.7.3, Kotlin 2.0.21. Java/Kotlin 타깃 17로 통일.
- Android SDK: `~/Library/Android/sdk`, platform 34 revision 3, Build Tools 34.0.0, Android Emulator 37.2.13, Platform Tools 37.0.1.
- Pleos Connect Emulator 2.1.0 ARM64, API 34. AVD `Flowad_Pleos_2_1`, 화면 2560×1440, RAM 4096MB, Cold boot.
- 공식 이미지 SHA-1: `24d28eb2f18eba5e87c861a7eb2bdccebb049419` 일치 확인. SDK 이미지의 내부 package ID는 `system-images;android-34;android-automotive;arm64-v8a`여서 해당 경로에 설치했다.
- NaviHelper SDK 3.0.5, 실제 에뮬레이터 Navi Service 3.0.4.
- Pleos와 Android SDK 약관은 사용자의 명시적 동의를 받은 뒤 설치했다. Android Studio GUI는 설치하지 않았다. CLI로 빌드와 가상 기기 실행이 가능하다.

## 검증 결과

| 항목 | 결과 |
| --- | --- |
| Gradle `assembleDebug` | 통과, APK 생성 |
| Gradle `testDebugUnitTest` | 8개 통과 |
| Pleos AVD 부팅·APK 설치·앱 실행 | 통과 |
| 실제 NaviHelper 초기화 | `Connected` 수신 |
| 네이티브 전송 확인 화면 | 기기 테스트 통과, screenshot 저장 |
| 두 경유지 + 목적지 요청 | 실제 SDK로 요청, `SearchStarted` 수신 |
| 경로 완료 및 목적지 확인 | 기존 `onRouteEnded` 수신 후 `getDestinationInfo` 좌표 대조, 안내 중 상태 진입 |
| 주행 제한 | Virtual Console P→D에서 실제 CarUxRestrictions DO=true, UxR=80 확인. 앱 버튼과 웹 화면 차단 테스트 통과. 이후 P 복원 |
| 실제 도착 콜백 | 미검증. emulator GPS를 3개 경유지로 순서대로 변경했지만 대기 시간 내 콜백 미수신. 해당 검증 테스트는 실패로 기록 |
| 도착 후 다음 구간 전송 | 실제 도착 이벤트가 없어 미검증. 단위 테스트에서만 진행 순서 검증 |
| 사용자 추천 경로 수신 | 미구현. 현재 실제 SDK 테스트는 명시된 에뮬레이터 예시 경로 사용 |
| 차량 배터리·위치 어댑터, 상태 복원 | 미구현 |

`realServiceConnectionAndNativeRouteConfirmation`는 요청이 안내 상태 또는 안전 중지 상태로 끝나는지 검사한다. 실제 안내 상태는 `artifacts/pleos/device-result.txt`에서 확인할 수 있다. 테스트 통과만으로 도착까지 성공했다고 해석하면 안 된다. `waitArrival=true`를 지정하면 실제 도착 콜백과 다음 구간 선택을 요구하며, 이번 실행은 콜백 미수신으로 실패했다.

## 재실행

```sh
scripts/pleos-gradle.sh :app:assembleDebug :app:testDebugUnitTest
scripts/pleos-emulator.sh
```

다른 터미널에서:

```sh
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$ADB" install -r pleos-android/app/build/outputs/apk/debug/app-debug.apk
"$ADB" shell am start -n kr.gyeollon.pleos/.MainActivity
"$ADB" forward tcp:8088 tcp:8088
```

Virtual Console: `http://127.0.0.1:8088/`. Android Studio에서도 같은 SDK 경로를 지정하면 AVD를 찾을 수 있다. 디버그 웹 미리보기는 `python3 -m http.server 8081 --directory dist --bind 127.0.0.1`로 실행할 수 있으나 정적 서버이므로 추천 API는 제공하지 않는다.

기기 테스트:

```sh
scripts/pleos-gradle.sh :app:assembleDebugAndroidTest
# 앱과 androidTest APK 설치 후
"$ADB" install -r pleos-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
"$ADB" shell am instrument -w -e class kr.gyeollon.pleos.NavigationDeviceTest#realServiceConnectionAndNativeRouteConfirmation kr.gyeollon.pleos.test/androidx.test.runner.AndroidJUnitRunner
```

주행 제한 테스트는 `-e class kr.gyeollon.pleos.NavigationDeviceTest#platformDrivingRestrictionHidesControls -e externalRestriction true`로 실행하고, 로그의 `WAITING FOR VIRTUAL CONSOLE D`가 표시되면 Virtual Console에서 D를 선택한다. 완료 후 P로 복원한다. 이 이미지에는 `hmg_car_service`가 없어 문서의 driving_regulation 명령은 작동하지 않는다. 해당 테스트는 플래그 없이 실행하면 생략한다.

## 경로와 콜백 연결

`Routing.Route.points`는 ORIGIN → SCENIC_WAYPOINT/CHARGING_STOP → RETURN 순서다. `RouteGuard`가 좌표·순서·종류·이름·개수·상태를 검사하고, 최대 두 개 경유지와 한 목적지로 연속 분할한다. 전체 지점의 원래 순서는 보존한다. 입력 크기는 앱 자원 보호를 위해 1,000개로 제한한다. 각 구간의 도로선은 순정 내비가 다시 탐색하므로 추천 경로선과 정확히 일치하는 것은 보장하지 않는다.

`PleosNavi`가 SDK를 초기화하고 리스너를 등록한다. `requestRouteWithWaypoints` 또는 목적지만 있는 구간의 `requestRoute`를 사용한다. `MainActivity`의 네이티브 확인 화면에서 사용자가 확인한 경우에만 요청한다. 경로 완료 후 목적지 좌표를 대조하며, 실제 도착 콜백은 이름·주소만 있고 좌표나 요청 ID가 없어 사용자 도착 확인을 추가로 요구한다. 외부 경로 변경·오류·응답 시간 초과는 진행을 중단한다. 앱 종료 시 리스너와 SDK 자원을 정리한다. 회전/프로세스 종료 후 자동 재개는 아직 없다.

SDK 3.0.5 문서는 `onRoutingCompleted`를 권장하지만, 해당 이미지의 Navi Service 3.0.4는 `onRouteEnded`를 보냈다. 두 콜백을 모두 수신하고 상태기계에서 중복 완료를 무시한다. 이를 확인하기 전에는 요청 후 시간 초과로 안전 중지됐으며, 호환 처리 후 안내 상태에 진입했다.

## 공식 요구사항과 남은 작업

- [개발 환경](https://document.pleos.ai/en/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator): minSdk 28 이상, Gradle 8 이상. 현재 compile/target API 34.
- [SDK 의존성](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/importing-sdk): 공식 Maven의 `ai.pleos.playground:NaviHelper:3.0.5` 사용.
- [버전 변경](https://document.pleos.ai/docs/pleos-only/release-note/sdk-261015): 3.0.5에서 좌표 순서 변경, 경유지 요청과 초기화 결과 콜백 추가. Kotlin 명명 인자를 사용한다.
- [권한](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/declaring-permissions): 현재 NAVI_ROUTE와 NAVI_ROUTE_SEARCH만 선언. NAVI_CUSTOM_MAP 화면 전환은 연결하지 않았다. 계정의 결론 프로젝트에서 경로 조회와 탐색은 사용 가능 상태였다.
- [경유지](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/NaviHelper/waypoint-settings): 최대 두 개. 추천 로직과 플랫폼 변환 코드는 분리되어 있다.
- [보안](https://document.pleos.ai/en/docs/pleos-only/app-registration-guide/app-security-guide): 현재 웹 브리지는 없다. 디버그에서만 로컬 웹과 예시 경로를 제공하며 릴리스에서는 해당 로딩을 막았다. 실제 웹 추천 경로를 받으려면 신뢰 출처 제한, 서버 발급 경로의 진위 확인, CSP, 제한된 브리지와 사용자 요청 검증을 구현해야 한다.
- [주행 안전](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/driver-distraction-guideline): CarUxRestrictions를 사용하며 미확인 상태는 차단한다. 앱 유형·지역별 정책과 DO 심사는 별도다. 웹의 미리보기 버튼은 제한 신호로 사용하지 않는다.
- [차량 데이터](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/intro): Vehicle capability와 권한 확인이 필요하다. FusedLocation은 별도 권한·차량 개인정보 설정 검증이 필요하며, 현재 앱에는 공통 차량 상태 어댑터를 연결하지 않았다.
- [심사](https://document.pleos.ai/en/docs/pleos-only/distribute/app-review-guide): 주의 분산·보안·안정성·개인정보 심사가 필요하며 현재 심사 통과를 주장하지 않는다.

다음 작업은 실제 도착 시나리오를 제공하는 Pleos 내비 테스트 수단 확인, 도착 후 다음 구간 실제 전송, 신뢰할 수 있는 웹 추천 경로 입력과 상태 복원이다.

## 2026-10-31 이어서 작업

- `JourneyStore`가 경로와 현재 구간 번호를 앱 비공개 저장소에 보관한다. 복원은 항상 PAUSED로 시작하며 내비 목적지가 확인됐다고 가정하지 않는다. 사용자는 정차 상태에서 현재 내비를 확인하고 해당 구간을 다시 요청하거나 저장된 경로를 삭제할 수 있다. 복원 시점에는 마지막으로 확인한 구간을 다시 보낼 수 있으므로 중복 안내가 생길 수 있다. 도착을 임의로 확정하거나 다음 구간을 자동 전송하지 않는다.
- Gradle 디버그 APK 빌드와 JVM 단위 테스트 통과. 복원 화면의 실제 에뮬레이터 회전·프로세스 종료 테스트는 아직 수행하지 않았다.
- [Virtual Console 공식 가이드](https://document.pleos.ai/en/docs/pleos-only/app-test-guide/virtual-console-guide)는 기어 및 차량 상태 시뮬레이션을 설명하지만 목적지 도착 이벤트를 발생시키는 공개 조작은 확인되지 않았다. 이전 GPS 이동 시도에서 실제 도착 이벤트가 오지 않았다. 내비 도착 시뮬레이터나 Devbox에서의 검증 방법을 Pleos 측에 확인해야 한다.
- 서버가 발급한 추천 경로의 진위 확인과 출처 제한 브리지, 실제 추천 코스 선택 연결 및 실제 도착 후 다음 구간 전송은 아직 구현·검증되지 않았다. 이 작업이 끝나기 전 웹에서 차량 기능을 호출할 수 있도록 브리지를 열지 않는다.

## 테스트 전용 도착 이벤트와 구간 이어가기

2026-10-31: Android 기기 테스트에서 첫 번째 실제 NaviHelper 경로가 확인된 뒤, 테스트 코드에서만 도착 이벤트를 주입하고 도착 확인 → 다음 구간 선택 → 실제 NaviHelper 복귀 경로 요청과 목적지 확인을 수행했다. Pleos 에뮬레이터에서 통과했다. `artifacts/pleos/simulated-arrival-result.txt`와 로그를 참고한다. 도착 이벤트 주입은 `androidTest`에서만 사용하며 앱 릴리스에 포함되지 않는다. 이 결과는 실제 차량 또는 Navi Service의 도착 콜백 발생을 증명하지 않는다. 실제 추천 경로 신뢰 입력과 실제 도착 콜백 검증은 여전히 미완료다.

## 웹 추천 입력 연결 (2026-10-31)

- 앱 WebView는 `https://ravirgo.com/flowad/`를 열며, `WebViewCompat.addWebMessageListener`를 정확한 HTTPS 출처와 최상위 프레임에만 허용한다. HTTP·파일 접근·혼합 콘텐츠는 허용하지 않는다. 해당 API를 지원하지 않는 WebView에서는 브리지를 등록하지 않는다.
- 웹은 코스 ID와 추천 조건만 전달한다. 앱은 전달된 좌표 목록을 신뢰하지 않고 고정 HTTPS 추천 API에 조건을 다시 제출해 선택된 ID가 실제 추천 응답에 있는지 확인한다. 응답 크기, 지점 수, 좌표, 순서, 상태를 검증한다. 웹과 서버의 재계산 결과는 달라질 수 있으므로 앱에서 전체 지점과 추정 상태를 표시하고 사용자 확인을 받는다. 내비 요청에는 별도의 확인과 주행 제한 확인이 필요하다.
- 출처 검사는 같은 출처의 XSS나 악성 스크립트를 막지 못한다. 웹 배포 전 CSP, 스크립트 공급망과 실제 운영 출처를 검토해야 한다. 원본 추천 응답의 서명이나 불변 ID는 없으며 재계산을 사용한다. 이것은 사용자가 웹에서 본 경로와 정확히 동일함을 암호학적으로 보장하지 않는다.
- Android Gradle 빌드 및 JVM 테스트 9개 통과. Pleos 에뮬레이터에서 응답 파싱/거부 테스트 2개와 WebView 메시지 기능 지원 테스트 통과. 운영 API 시험 요청은 30초 내 응답하지 않아 실제 웹 추천 → 서버 재계산 → 사용자 확인 → 내비 전송의 종단 검증은 미완료다. 변경한 웹 파일은 아직 운영 사이트에 배포하지 않았다.
