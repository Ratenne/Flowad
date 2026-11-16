package kr.gyeollon.pleos
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
class JourneyStoreDeviceTest {
 private val context = InstrumentationRegistry.getInstrumentation().targetContext
 private val name = "journey_test"
 private fun route() = RecommendedRoute((0..4).map { RoutePoint(it, if (it==0) "ORIGIN" else if(it==4) "RETURN" else "SCENIC_WAYPOINT", "지점$it", 37.0+it/100.0,127.0) }, "ROAD_ROUTED")
 @Test fun restoresPausedAndDoesNotRepeatConfirmedSegment() {
  val store = JourneyStore(context,name)
  try {
   val journey=SegmentJourney(route()); journey.beginRequest(); journey.routingCompleted(); journey.destinationArrived(3)
   store.save(journey)
   val restored=store.load()!!
   assertEquals(1,restored.index)
   assertEquals(SegmentJourney.State.PAUSED,restored.state)
   assertThrows(IllegalStateException::class.java) { restored.beginRequest() }
  } finally { store.clear() }
 }
 @Test fun corruptStateIsDiscarded() {
  val preferences=context.getSharedPreferences(name,0)
  preferences.edit().putString("current","invalid").commit()
  assertNull(JourneyStore(context,name).load())
  assertFalse(preferences.contains("current"))
 }
}
