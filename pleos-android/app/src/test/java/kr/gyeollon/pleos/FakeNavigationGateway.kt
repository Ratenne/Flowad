package kr.gyeollon.pleos

/** Test-only gateway. Events are emitted explicitly by a test, never by request(). */
class FakeNavigationGateway(private val connects: Boolean) : NavigationGateway {
    var lastPlan: NavigationPlan? = null
        private set
    private var connected = false
    private var callback: ((NavigationEvent) -> Unit)? = null
    override fun connect(callback: (Boolean) -> Unit) { connected = connects; callback(connects) }
    override fun request(plan: NavigationPlan, callback: (NavigationEvent) -> Unit) {
        if (!connected) { callback(NavigationEvent.UNAVAILABLE); return }
        lastPlan = plan
        this.callback = callback
        callback(NavigationEvent.REQUESTED)
    }
    fun emit(event: NavigationEvent) { callback?.invoke(event) }
    override fun close() { connected = false; callback = null }
}
