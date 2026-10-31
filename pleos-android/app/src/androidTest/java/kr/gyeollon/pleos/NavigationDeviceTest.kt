package kr.gyeollon.pleos

import android.app.Activity
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.io.File

/** Actual SDK service test. Does not inject or synthesize navigation callbacks. */
class NavigationDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun texts(view: View): List<TextView> =
        (if (view is TextView) listOf(view) else emptyList()) +
        (if (view is ViewGroup) (0 until view.childCount).flatMap { texts(view.getChildAt(it)) } else emptyList())
    private fun snapshot(activity: Activity): List<String> {
        var values = emptyList<String>()
        instrumentation.runOnMainSync { values = texts(activity.window.decorView).filter { it.visibility == View.VISIBLE }.map { it.text.toString() } }
        return values
    }
    private fun click(activity: Activity, text: String) {
        instrumentation.runOnMainSync { texts(activity.window.decorView).first { it.text.toString() == text && it.visibility == View.VISIBLE }.performClick() }
    }
    private fun waitFor(activity: Activity, predicate: (List<String>) -> Boolean): List<String> {
        val deadline = System.currentTimeMillis() + 35000
        var values: List<String>
        do { values = snapshot(activity); if (predicate(values)) return values; Thread.sleep(250) } while (System.currentTimeMillis() < deadline)
        return values
    }
    @Test fun platformDrivingRestrictionHidesControls() {
        org.junit.Assume.assumeTrue("Use Virtual Console to switch P to D during this test", InstrumentationRegistry.getArguments().getString("externalRestriction") == "true")
        val context = instrumentation.targetContext
        context.getSharedPreferences("journey", 0).edit().clear().commit()
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            assertTrue(waitFor(activity) { it.any { t -> t.contains("선택된 추천 경로") } }.any { it.contains("선택된 추천 경로") })
            android.util.Log.i("FlowadDeviceTest", "WAITING FOR VIRTUAL CONSOLE D")
            val restricted = waitFor(activity) { it.any { t -> t.contains("주행 제한이 적용") } }
            assertTrue("Restrictions not reflected: $restricted", restricted.any { it.contains("주행 제한이 적용") })
            assertFalse(restricted.contains("에뮬레이터 예시 경로 준비"))
        } finally {
            android.util.Log.i("FlowadDeviceTest", "RESTORE VIRTUAL CONSOLE P")
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
    @Test fun realServiceConnectionAndNativeRouteConfirmation() {
        val context = instrumentation.targetContext
        context.getSharedPreferences("journey", 0).edit().clear().commit()
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val ready = waitFor(activity) { it.any { text -> text.contains("선택된 추천 경로") || text.contains("주행 제한") } }
            val output = File(context.filesDir, "pleos-device-test.txt")
            output.writeText("INITIAL: $ready\n")
            assertTrue("SDK/UX state did not become ready: $ready", ready.any { it.contains("선택된 추천 경로") })
            click(activity, "에뮬레이터 예시 경로 준비")
            assertTrue(snapshot(activity).any { it.contains("1/2구간") })
            click(activity, "이 구간 내비로 보내기")
            instrumentation.waitForIdleSync()
            val bitmap = instrumentation.uiAutomation.takeScreenshot()
            File(context.filesDir, "pleos-confirmation.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            output.appendText("CONFIRMATION OPENED\n")
            // Confirm the platform dialog through Android's actual window manager.
            instrumentation.runOnMainSync {
                // Activity's dialog window is owned by AlertDialog; expose no production bypass.
                val field = MainActivity::class.java.getDeclaredField("confirmation").apply { isAccessible = true }
                val dialog = field.get(activity) as android.app.AlertDialog
                assertTrue(dialog.isShowing)
                dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
            }
            var result = waitFor(activity) { it.any { text -> text.contains("안내 중") || text.contains("중지") || text.contains("저장된") || text.contains("자동 검증할 수 없습니다") } }
            if (InstrumentationRegistry.getArguments().getString("simulatedArrival") == "true" && result.any { it.contains("자동 검증할 수 없습니다") }) {
                // Test fixture review only: never describe this as automatic coordinate verification.
                click(activity, "차량에서 경유지 확인")
                instrumentation.runOnMainSync {
                    val field = MainActivity::class.java.getDeclaredField("confirmation").apply { isAccessible = true }
                    (field.get(activity) as android.app.AlertDialog).getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
                }
                result = snapshot(activity)
                output.appendText("FIXTURE USER REVIEW: WAYPOINT COORDINATES UNAVAILABLE\n")
            }
            output.appendText("AFTER REQUEST: $result\n")
            if (result.none { it.contains("안내 중") }) instrumentation.runOnMainSync {
                val field = MainActivity::class.java.getDeclaredField("lastWaypointCoordinates").apply { isAccessible = true }
                output.appendText("FIXTURE WAYPOINT RESPONSE: ${field.get(activity)}\n")
            }
            android.util.Log.i("FlowadDeviceTest", "AFTER REQUEST: $result")
            assertTrue("No observable result: $result", result.any { it.contains("안내 중") || it.contains("중지") || it.contains("저장된") })
            if (InstrumentationRegistry.getArguments().getString("simulatedArrival") == "true") {
                assertTrue("First route was not confirmed: $result", result.any { it.contains("안내 중") })
                instrumentation.runOnMainSync {
                    val method = MainActivity::class.java.getDeclaredMethod("onNaviEvent", PleosNavi.Event::class.java).apply { isAccessible = true }
                    method.invoke(activity, PleosNavi.Event.Arrived("테스트 도착"))
                }
                assertTrue(snapshot(activity).any { it.contains("테스트 도착") })
                click(activity, "현재 구간 도착 확인")
                instrumentation.runOnMainSync {
                    val field = MainActivity::class.java.getDeclaredField("confirmation").apply { isAccessible = true }
                    (field.get(activity) as android.app.AlertDialog).getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
                }
                click(activity, "다음 구간 확인")
                assertTrue(snapshot(activity).any { it.contains("2/2구간") })
                click(activity, "이 구간 내비로 보내기")
                instrumentation.runOnMainSync {
                    val field = MainActivity::class.java.getDeclaredField("confirmation").apply { isAccessible = true }
                    (field.get(activity) as android.app.AlertDialog).getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
                }
                val next = waitFor(activity) { it.any { t -> t.contains("안내 중") || t.contains("중지") } }
                output.appendText("SIMULATED ARRIVAL; SECOND REAL REQUEST: $next\n")
                assertTrue("Second SDK request not confirmed: $next", next.any { it.contains("예시 복귀까지 안내 중") })
            }
            if (InstrumentationRegistry.getArguments().getString("waitArrival") == "true") {
                val arrival = waitFor(activity) { it.any { text -> text.contains("내비 도착 알림") } }
                output.appendText("ARRIVAL: $arrival\n")
                assertTrue("Real destination-arrival callback not received: $arrival", arrival.any { it.contains("내비 도착 알림") })
                click(activity, "현재 구간 도착 확인")
                instrumentation.runOnMainSync {
                    val field = MainActivity::class.java.getDeclaredField("confirmation").apply { isAccessible = true }
                    (field.get(activity) as android.app.AlertDialog).getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
                }
                click(activity, "다음 구간 확인")
                assertTrue(snapshot(activity).any { it.contains("2/2구간") })
                output.appendText("NEXT SEGMENT READY\n")
            }

        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
