# Pleos 4단계 검증 기록

검증일: 2026-11-01. Pleos 변경은 별도 `codex/pleos-release` 브랜치에서 기존 main의 Tesla·도로 변경을 보존한 채 통합했다. 운영 기능 커밋은 `f17ba8a`, 초기 배포 main은 `7eb1c1f`다. 비밀키·티켓·사용자 위치는 이 기록에 포함하지 않는다.

| 항목 | 결과와 범위 |
|---|---|
| Android Debug / Release | Gradle 빌드와 lintVitalRelease 통과. Release APK는 unsigned이며 마켓 배포물이 아니다. |
| 서버 테스트 | 33개 통과. 티켓 발급→검증 후 원본 경유지·순서·상태 일치, 변조·만료·다른 키 거부 포함. 테스트의 도로 제공자는 대역이다. |
| Android 단위 테스트 | 10개 통과. 구간 분할·입력 검증·출처 정책·실패 상태 포함. |
| 웹 엔진·배터리·지형 | 기존 Node 테스트 통과. 실도로 검증을 의미하지 않는다. |
| SDK 실연결과 구간 요청 | Pleos AVD 2.1.0 / Navi Service 3.0.4에 실제 요청. 완료 이벤트와 목적지 응답 확인. |
| 경유지 응답 한계 | AVD가 경유지 좌표를 0,0으로 반환했다. 자동 좌표 검증 성공으로 처리하지 않고 개수 일치 시 사용자 직접 확인을 요구한다. |
| 다음 구간 전송 | androidTest에서만 도착을 주입→사용자 도착 확인→다음 구간 확인→두 번째 실제 SDK 요청 및 복귀 목적지 안내 확인. 실제 도착 신호 발생은 미검증. |
| 실제 주행 제한 | Virtual Console의 P→D 신호와 CarUxRestrictions에 따른 조작 차단 확인. 웹 미리보기와 별개다. |
| 출처·복원 디바이스 테스트 | 8개 통과. 출처 차단, 서버 경로 파싱, AES-GCM 암호화 저장·매번 다른 nonce·변조 거부, 체크포인트 복원, Activity 재생성 검증. 복원 후 자동 전송하지 않는다. |
| 운영 웹 | `https://ravirgo.com/flowad/`의 티켓 전송 코드 확인. `/api/navigation/resolve`에 위조 티켓을 POST해 HTTP 400 확인. |
| 운영 추천→앱 정상 경로 | **미완료**. 공개 서울 체험 입력에 운영 추천 API가 `courses:[]`, `routingFailed:1`을 반환했다. 성공 경로를 기다리는 opt-in 테스트 1개가 실패했다. 도로 API 설정·응답의 별도 문제를 Pleos 작업에서 임의 변경하지 않았다. |
| 운영 실패 화면 | AVD의 실제 HTTPS WebView에서 서울 체험 실행→도로 계산 실패 표시→내비 버튼·journey 미생성 테스트 1개 통과. |

## 재실행

```sh
scripts/pleos-emulator.sh
scripts/pleos-gradle.sh :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:assembleRelease
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb install -r pleos-android/app/build/outputs/apk/debug/app-debug.apk
adb install -r pleos-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e class kr.gyeollon.pleos.LiveWebRecommendationTest -e liveRecommendations true kr.gyeollon.pleos.test/androidx.test.runner.AndroidJUnitRunner
```

정상 운영 추천이 다시 제공되면 마지막 명령은 웹 경유지와 네이티브 확인 경유지의 일치를 확인한다. 현재 실패 상태를 재검증하려면 `-e expectRoutingFailure true`를 추가한다. 실패 상태 테스트 통과를 정상 경로 연결 완료로 세지 않는다.

실제 두 구간 요청 테스트는 `-e class kr.gyeollon.pleos.NavigationDeviceTest#realServiceConnectionAndNativeRouteConfirmation -e simulatedArrival true`로 실행한다. 이 옵션은 테스트 APK에서만 도착을 주입하고 실제 에뮬레이터 내비 경로를 변경한다. 실제 차량에서는 실행하지 않는다.

실차 위치·SOC·잔여 주행거리, 실제 도착 콜백 발생, 내비 화면 자동 전환, 앱 마켓 심사는 완료하지 않았다. 운영 추천 제공자 복구 후 정상 웹 추천→앱 확인의 재검증이 남아 있다.
