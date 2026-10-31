package kr.gyeollon.pleos
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
class RestoreActivityDeviceTest {
 @Test fun recreationKeepsCheckpointPaused() {
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val preferences=context.getSharedPreferences("journey",0)
  val backup=preferences.getString("current",null)
  val route=RecommendedRoute(listOf(RoutePoint(0,"ORIGIN","출발",37.0,127.0),RoutePoint(1,"RETURN","복귀",37.0,127.0)),"ROAD_ROUTED")
  JourneyStore(context).save(SegmentJourney(route))
  try {
   ActivityScenario.launch(MainActivity::class.java).use { scenario ->
    fun verify() { scenario.onActivity { activity ->
     val f=MainActivity::class.java.getDeclaredField("journey").apply { isAccessible=true }
     val restored=f.get(activity) as SegmentJourney
     assertEquals(SegmentJourney.State.PAUSED,restored.state)
     assertEquals(route,restored.route)
    } }
    verify(); scenario.recreate(); verify()
   }
  } finally { preferences.edit().putString("current",backup).commit() }
 }
}
