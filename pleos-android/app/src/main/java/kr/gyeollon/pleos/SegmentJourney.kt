package kr.gyeollon.pleos

/**
 * Platform-independent progression. All calls must be serialized by the caller.
 * SDK event correlation and destination verification belong to the platform adapter.
 */
class SegmentJourney(val route: RecommendedRoute, restoredIndex: Int? = null) {
    val segments = RouteGuard.prepare(route)
    var index: Int = restoredIndex ?: 0
        private set
    var state: State = if (restoredIndex == null) State.READY else State.PAUSED
        private set
    init { require(index in segments.indices) }
    val current: NavigationPlan get() = segments[index]

    /** Explicit user action is required after restoration or loss of synchronization. */
    fun resumeForResend() { check(state == State.PAUSED); state = State.READY }

    enum class State { READY, REQUESTING, GUIDING, AWAITING_CONFIRMATION, FINISHED, FAILED, PAUSED }

    /** Caller must check native user intent and current platform UX restrictions. */
    fun beginRequest(): NavigationPlan {
        check(state == State.READY || state == State.FAILED) { "현재 구간을 요청할 수 없습니다" }
        state = State.REQUESTING
        return current
    }

    /** Called only when the adapter has correlated a successful route-search event. */
    fun routingCompleted() {
        check(state == State.REQUESTING)
        state = State.GUIDING
    }

    fun requestFailed() {
        check(state == State.REQUESTING)
        state = State.FAILED
    }

    /** Arrival is accepted only after the adapter verifies it belongs to this destination. */
    fun destinationArrived(verifiedDestinationOrder: Int) {
        check(state == State.GUIDING && current.destination.order == verifiedDestinationOrder)
        state = if (index == segments.lastIndex) State.FINISHED else State.AWAITING_CONFIRMATION
    }

    /** Requires a fresh user action and an allowed platform UX state in the caller. */
    fun confirmNext() {
        check(state == State.AWAITING_CONFIRMATION)
        index++
        state = State.READY
    }

    /** Unknown connection, external route change or restart must not advance the itinerary. */
    fun pause() {
        if (state != State.FINISHED) state = State.PAUSED
    }
}
