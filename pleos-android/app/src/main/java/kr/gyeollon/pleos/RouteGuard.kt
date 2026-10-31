package kr.gyeollon.pleos

/** Mirrors the ordered points returned by the recommendation API. */
data class RoutePoint(val order: Int, val type: String, val name: String, val latitude: Double, val longitude: Double)
data class RecommendedRoute(val points: List<RoutePoint>, val status: String)
data class NavigationPlan(val waypoints: List<RoutePoint>, val destination: RoutePoint)

object RouteGuard {
    const val MAX_WAYPOINTS = 2
    // Bound resources consumed by untrusted inputs; this is not a Pleos SDK limit.
    const val MAX_ROUTE_POINTS = 1000

    fun prepare(route: RecommendedRoute): List<NavigationPlan> {
        require(route.status == "ROAD_ROUTED" || route.status == "ESTIMATED_NOT_ROAD_ROUTED") { "지원하지 않는 경로 상태" }
        require(route.points.size in 2..MAX_ROUTE_POINTS) { "경로 지점 수가 올바르지 않습니다" }
        route.points.forEachIndexed { index, point ->
            require(point.order == index && point.name.isNotBlank() && point.name.length <= 200) { "잘못된 경로 순서 또는 이름" }
            require(point.latitude.isFinite() && point.latitude in -90.0..90.0 && point.longitude.isFinite() && point.longitude in -180.0..180.0) { "잘못된 좌표" }
            val expected = when (index) { 0 -> setOf("ORIGIN"); route.points.lastIndex -> setOf("RETURN"); else -> setOf("SCENIC_WAYPOINT", "CHARGING_STOP") }
            require(point.type in expected) { "잘못된 경로 지점 유형" }
        }
        // Each chunk contains at most two waypoints followed by its destination.
        // The next chunk starts after that destination; no stop is omitted or repeated.
        return route.points.drop(1).chunked(MAX_WAYPOINTS + 1).map { chunk ->
            NavigationPlan(chunk.dropLast(1), chunk.last())
        }
    }
}

/** No SDK result is fabricated: submission and a navigation callback are distinct. */
interface NavigationGateway {
    fun connect(callback: (Boolean) -> Unit)
    fun request(plan: NavigationPlan, callback: (NavigationEvent) -> Unit)
    fun close()
}
enum class NavigationEvent { REQUESTED, ROUTE_STARTED, ROUTING_COMPLETED, ERROR, UNAVAILABLE }
