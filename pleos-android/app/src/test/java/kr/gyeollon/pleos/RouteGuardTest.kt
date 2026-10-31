package kr.gyeollon.pleos

import org.junit.Assert.*
import org.junit.Test

class RouteGuardTest {
    private fun point(order: Int, type: String) = RoutePoint(order, type, "지점$order", 37.0 + order / 10000.0, 127.0)
    private fun route(waypoints: Int): RecommendedRoute = RecommendedRoute(
        listOf(point(0, "ORIGIN")) + (1..waypoints).map { point(it, "SCENIC_WAYPOINT") } + point(waypoints + 1, "RETURN"), "ROAD_ROUTED")

    @Test fun preservesAllPointsAcrossManySegmentSizes() {
        for (count in 0..100) {
            val route = route(count)
            val segments = RouteGuard.prepare(route)
            assertTrue(segments.all { it.waypoints.size <= 2 })
            assertEquals(route.points.drop(1), segments.flatMap { it.waypoints + it.destination })
            assertEquals("RETURN", segments.last().destination.type)
        }
    }
    @Test fun threeWaypointsEndFirstSegmentAtThirdWaypoint() {
        val segments = RouteGuard.prepare(route(3))
        assertEquals(listOf(1, 2), segments[0].waypoints.map { it.order })
        assertEquals(3, segments[0].destination.order)
        assertTrue(segments[1].waypoints.isEmpty())
        assertEquals(4, segments[1].destination.order)
    }
    @Test fun rejectsInvalidCoordinatesAndOrder() {
        val r = route(2)
        assertThrows(IllegalArgumentException::class.java) { RouteGuard.prepare(r.copy(points = r.points.mapIndexed { i, p -> if (i == 1) p.copy(latitude = Double.NaN) else p })) }
        assertThrows(IllegalArgumentException::class.java) { RouteGuard.prepare(r.copy(points = r.points.mapIndexed { i, p -> if (i == 1) p.copy(order = 2) else p })) }
    }
    @Test fun rejectsUnknownStatus() {
        assertThrows(IllegalArgumentException::class.java) { RouteGuard.prepare(route(1).copy(status = "UNKNOWN")) }
    }
    @Test fun requiresCorrelatedArrivalAndExplicitNextConfirmation() {
        val journey = SegmentJourney(route(3))
        journey.beginRequest()
        assertThrows(IllegalStateException::class.java) { journey.destinationArrived(3) }
        journey.routingCompleted()
        assertThrows(IllegalStateException::class.java) { journey.destinationArrived(4) }
        journey.destinationArrived(3)
        assertEquals(SegmentJourney.State.AWAITING_CONFIRMATION, journey.state)
        assertThrows(IllegalStateException::class.java) { journey.beginRequest() }
        journey.confirmNext()
        assertEquals(4, journey.beginRequest().destination.order)
        journey.routingCompleted()
        journey.destinationArrived(4)
        assertEquals(SegmentJourney.State.FINISHED, journey.state)
    }
    @Test fun restoredJourneyRequiresExplicitResend() {
        val restored = SegmentJourney(route(3), 1)
        assertEquals(SegmentJourney.State.PAUSED, restored.state)
        assertThrows(IllegalStateException::class.java) { restored.beginRequest() }
        restored.resumeForResend()
        assertEquals(4, restored.beginRequest().destination.order)
        assertThrows(IllegalArgumentException::class.java) { SegmentJourney(route(3), 2) }
    }
    @Test fun failureAndExternalChangesNeverAdvance() {
        val journey = SegmentJourney(route(3))
        journey.beginRequest()
        journey.requestFailed()
        assertEquals(0, journey.index)
        journey.beginRequest()
        journey.pause()
        assertThrows(IllegalStateException::class.java) { journey.routingCompleted() }
        assertEquals(0, journey.index)
    }
}

class FakeGatewayTest {
    private val plan = NavigationPlan(listOf(RoutePoint(1, "SCENIC_WAYPOINT", "경유", 37.1, 127.1)), RoutePoint(2, "RETURN", "복귀", 37.0, 127.0))
    @Test fun requestDoesNotPretendToComplete() {
        val gateway = FakeNavigationGateway(true)
        val events = mutableListOf<NavigationEvent>()
        gateway.connect { assertTrue(it) }
        gateway.request(plan) { events.add(it) }
        assertEquals(listOf(NavigationEvent.REQUESTED), events)
        gateway.emit(NavigationEvent.ERROR)
        assertEquals(NavigationEvent.ERROR, events.last())
        gateway.close()
        gateway.emit(NavigationEvent.ROUTING_COMPLETED)
        assertEquals(NavigationEvent.ERROR, events.last())
    }
    @Test fun failedConnectionRejectsRequest() {
        val gateway = FakeNavigationGateway(false)
        gateway.connect { assertFalse(it) }
        var result: NavigationEvent? = null
        gateway.request(plan) { result = it }
        assertEquals(NavigationEvent.UNAVAILABLE, result)
        assertNull(gateway.lastPlan)
    }
}
