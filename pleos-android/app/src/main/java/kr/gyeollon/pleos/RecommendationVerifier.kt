package kr.gyeollon.pleos

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Coordinates are accepted only from a fresh response from the configured HTTPS service. */
object RecommendationVerifier {
    private const val ENDPOINT = "https://ravirgo.com/flowad/api/navigation/resolve"
    fun fetch(message: String): RecommendedRoute {
        require(message.length <= 66_000)
        val envelope = JSONObject(message)
        require(envelope.length() == 1)
        val ticket = envelope.getString("ticket")
        require(ticket.length in 1..65000)
        val request = JSONObject().put("ticket", ticket).toString().toByteArray(Charsets.UTF_8)
        val conn = URL(ENDPOINT).openConnection() as HttpURLConnection
        try {
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15000; conn.readTimeout = 30000
            conn.requestMethod = "POST"; conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(request) }
            check(conn.responseCode == 200) { "추천 서버 응답 오류" }
            val bytes = conn.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    require(out.size() + n <= 1_000_000)
                    out.write(buffer, 0, n)
                }
                out.toByteArray()
            }
            require(bytes.size <= 1_000_000)
            return parseResolved(String(bytes, Charsets.UTF_8))
        } finally { conn.disconnect() }
    }
    internal fun parseResolved(response: String): RecommendedRoute {
        val result = JSONObject(response)
        require(result.getString("courseId").matches(Regex("[a-z0-9-]{1,64}")))
        val route = result.getJSONObject("route")
        val arr = route.getJSONArray("points")
        require(arr.length() in 2..RouteGuard.MAX_ROUTE_POINTS)
        val points = (0 until arr.length()).map { i ->
            val p = arr.getJSONObject(i)
            RoutePoint(p.getInt("order"), p.getString("type"), p.getString("name"), p.getDouble("latitude"), p.getDouble("longitude"))
        }
        return RecommendedRoute(points, route.getString("status")).also { RouteGuard.prepare(it) }
    }
}
