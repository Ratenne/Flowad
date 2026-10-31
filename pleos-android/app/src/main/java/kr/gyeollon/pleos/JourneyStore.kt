package kr.gyeollon.pleos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Restored journeys are always paused; no previous SDK state is assumed valid. */
class JourneyStore(context: Context, name: String = "journey") {
    private val preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    fun save(journey: SegmentJourney) {
        val points = JSONArray()
        journey.route.points.forEach { p -> points.put(JSONObject().put("order", p.order).put("type", p.type).put("name", p.name).put("lat", p.latitude).put("lon", p.longitude)) }
        val json = JSONObject().put("version", 2).put("savedAt", System.currentTimeMillis()).put("status", journey.route.status).put("points", points).put("index", if (journey.state == SegmentJourney.State.AWAITING_CONFIRMATION) journey.index + 1 else journey.index)
        preferences.edit().putString("current", json.toString()).apply()
    }
    fun clear() { preferences.edit().remove("current").apply() }
    fun load(): SegmentJourney? {
      return try {
        val raw = preferences.getString("current", null) ?: return null
        require(raw.length <= 256_000)
        val json = JSONObject(raw)
        require(json.getInt("version") == 2)
        val age = System.currentTimeMillis() - json.getLong("savedAt")
        require(age in 0..86_400_000L)
        val a = json.getJSONArray("points")
        require(a.length() in 2..RouteGuard.MAX_ROUTE_POINTS)
        val points = (0 until a.length()).map { i ->
            val p = a.getJSONObject(i)
            RoutePoint(p.getInt("order"), p.getString("type"), p.getString("name"), p.getDouble("lat"), p.getDouble("lon"))
        }
        SegmentJourney(RecommendedRoute(points, json.getString("status")), json.getInt("index"))
      } catch (_: Exception) { clear(); null }
    }
}
