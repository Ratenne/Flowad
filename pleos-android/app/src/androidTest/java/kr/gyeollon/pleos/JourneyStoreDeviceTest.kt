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
 @Test fun encryptedCheckpointUsesFreshNonceAndRejectsTampering() {
  val store=JourneyStore(context,name); val prefs=context.getSharedPreferences(name,0)
  try {
   store.save(SegmentJourney(route())); val first=prefs.getString("current",null)!!
   assertFalse(first.contains("지점")); assertFalse(first.contains("latitude")); assertNotNull(store.load())
   store.save(SegmentJourney(route())); val second=prefs.getString("current",null)!!
   assertNotEquals(org.json.JSONObject(first).getString("iv"),org.json.JSONObject(second).getString("iv"))
   val envelope=org.json.JSONObject(second); val bytes=android.util.Base64.decode(envelope.getString("ciphertext"),0)
   bytes[0]=(bytes[0].toInt() xor 1).toByte()
   envelope.put("ciphertext",android.util.Base64.encodeToString(bytes,2))
   prefs.edit().putString("current",envelope.toString()).commit()
   assertNull(store.load()); assertFalse(prefs.contains("current"))
  } finally { store.clear() }
 }
 @Test fun corruptStateIsDiscarded() {
  val preferences=context.getSharedPreferences(name,0)
  preferences.edit().putString("current","invalid").commit()
  assertNull(JourneyStore(context,name).load())
  assertFalse(preferences.contains("current"))
 }
}
