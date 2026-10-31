package kr.gyeollon.pleos

import android.content.Context
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.data.RouteWithWaypointsRequest
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.data.WaypointInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener

/** All callbacks are marshalled by the Activity before touching UI or journey state. */
class PleosNavi(context: Context, private val emit: (Event) -> Unit) {
    sealed class Event {
        object Connected : Event()
        object ConnectionFailed : Event()
        object SearchStarted : Event()
        object SearchCompleted : Event()
        object RouteChanged : Event()
        object RouteCancelled : Event()
        data class Error(val message: String) : Event()
        data class Destination(val latitude: Double, val longitude: Double) : Event()
        data class Waypoints(val coordinates: List<Pair<Double, Double>>) : Event()
        data class Location(val latitude: Double, val longitude: Double) : Event()
        data class Arrived(val name: String) : Event()
    }
    private val helper = NaviHelper(context.applicationContext)
    private var closed = false
    private var listening = false
    private val listener = object : NaviHelperEventListener {
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) = emit(Event.SearchStarted)
        override fun onRoutingCompleted() = emit(Event.SearchCompleted)
        // Emulator 2.1.0 ships Navi Service 3.0.4, which still emits the legacy callback.
        @Suppress("DEPRECATION")
        override fun onRouteEnded() = emit(Event.SearchCompleted)
        override fun onDestinationInfo(destinationInfo: DestinationInfo) = emit(Event.Destination(destinationInfo.latitude, destinationInfo.longitude))
        override fun onWayPointInfo(waypointInfo: List<WaypointInfo>) = emit(Event.Waypoints(waypointInfo.map { it.latitude to it.longitude }))
        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) = emit(Event.Location(currentLocationInfo.latitude, currentLocationInfo.longitude))
        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) = emit(Event.Arrived(destinationArrivedInfo.name))
        override fun onDestinationChanged() = emit(Event.RouteChanged)
        override fun onWaypointChanged(waypointChangedInfo: WaypointChangedInfo) = emit(Event.RouteChanged)
        override fun onRouteCancelled() = emit(Event.RouteCancelled)
        override fun onError(errorCode: NaviErrorCode) = emit(Event.Error(errorCode.toString()))
    }
    fun connect() {
        try {
            helper.initialize(onConnected = {
                if (!closed) { helper.addListener(listener); listening = true; emit(Event.Connected) }
            }, onFailed = { if (!closed) emit(Event.ConnectionFailed) })
        } catch (_: Exception) { emit(Event.ConnectionFailed) }
    }
    fun request(plan: NavigationPlan) {
        check(!closed && listening)
        require(plan.waypoints.size <= RouteGuard.MAX_WAYPOINTS)
        val dest = plan.destination
        val destination = RouteInfo(latitude = dest.latitude, longitude = dest.longitude, poiName = dest.name, poiId = "", address = "", poiSubId = "")
        val waypoints = plan.waypoints.mapIndexed { index, point ->
            RequestWaypointInfo(latitude = point.latitude, longitude = point.longitude, poiName = point.name,
                waypointIndex = if (index == 0) WaypointIndex.FIRST else WaypointIndex.SECOND, poiId = "", address = "", poiSubId = "")
        }
        if (waypoints.isEmpty()) helper.requestRoute(destination)
        else helper.requestRouteWithWaypoints(RouteWithWaypointsRequest(destination, waypoints))
    }
    fun queryLocation() { check(!closed && listening); helper.getCurrentLocationInfo() }
    fun queryDestination() { check(!closed && listening); helper.getDestinationInfo(); helper.getWaypointInfo() }
    fun close() {
        closed = true
        if (listening) helper.removeListener(listener)
        listening = false
        helper.release()
    }
}
