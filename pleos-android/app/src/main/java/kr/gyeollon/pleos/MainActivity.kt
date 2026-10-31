package kr.gyeollon.pleos

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.os.Handler
import android.util.Log
import android.os.Looper
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/** Origin-scoped recommendation intake with native user confirmation. */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private var vehicleAdapter: PleosVehicleAdapter? = null
    private lateinit var vehicleButton: Button
    private var vehicleReading = VehicleReading("NO_DATA", null, null, null, true, null, null, "NO_DATA")
    private var vehicleRequest = 0
    private lateinit var navi: PleosNavi
    private lateinit var restriction: ParkedRestriction
    private lateinit var status: TextView
    private lateinit var action: Button
    private lateinit var retryWeb: Button
    private lateinit var discard: Button
    private lateinit var web: WebView
    private var journey: SegmentJourney? = null
    private lateinit var journeyStore: JourneyStore
    private var connected = false
    private var awaitingDestination = false
    private var destinationMatched = false
    private var awaitingWaypoints = false
    private var waypointsMatched = false
    private var waypointReviewRequired = false
    private var waypointUserConfirmed = false
    private var lastWaypointCoordinates: List<Pair<Double, Double>> = emptyList()
    private var arrivalName: String? = null
    private var generation = 0
    private var destroyed = false
    private var verifyingRoute = false
    private var webFailed = false
    private var rendererGone = false
    private var testButton: Button? = null
    private var confirmation: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        journeyStore = JourneyStore(applicationContext)
        journey = journeyStore.load()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        status = TextView(this).apply { textSize = 18f; text = "내비 연결 및 주행 제한 확인 중" }
        action = Button(this).apply { visibility = View.GONE }
        discard = Button(this).apply { text = "저장된 경로 삭제"; visibility = View.GONE; setOnClickListener { showConfirm("저장된 경로 삭제", "저장된 코스와 진행 정보를 삭제할까요?") { journey = null; journeyStore.clear(); render() } } }
        root.addView(status)
        root.addView(action)
        root.addView(discard)
        retryWeb = Button(this).apply { text = "화면 다시 불러오기"; visibility = View.GONE; setOnClickListener { if (restriction.canInteract()) { if (rendererGone) recreate() else { webFailed = false; web.reload(); render() } } } }
        root.addView(retryWeb)
        vehicleButton = Button(this).apply { text = "차량 상태 조회"; setOnClickListener {
            if (canAct()) {
                vehicleReading = VehicleReading("NO_DATA", null, null, null, true, null, null, "NO_DATA")
                val token = ++vehicleRequest
                try {
                    if (vehicleAdapter == null) vehicleAdapter = PleosVehicleAdapter(applicationContext)
                    vehicleAdapter?.battery { value -> main.post {
                        if (!destroyed && token == vehicleRequest) vehicleReading = vehicleReading.copy(status = if (value == null) "NO_DATA" else "LIVE", batteryPercent = value, observedAt = if (value == null) null else System.currentTimeMillis(), stale = value == null)
                    } }
                    navi.queryLocation()
                } catch (_: Exception) { }
                main.postDelayed({ if (!destroyed && token == vehicleRequest && canAct()) {
                    val reading = vehicleReading
                    showConfirm("차량 상태", "배터리 ${reading.batteryPercent?.toString() ?: "미제공"}% · 잔여 주행거리 미제공\n위치 ${if (reading.locationStatus == "LIVE") "조회됨" else "미제공"}\n누락된 값은 웹 설정에서 직접 입력해 주세요.") { }
                } }, 5000)
            }
        } }
        root.addView(vehicleButton)
        if (BuildConfig.DEBUG) {
            testButton = Button(this).apply {
                text = "에뮬레이터 예시 경로 준비"
                setOnClickListener { prepareExample() }
            }
            root.addView(testButton)
        }
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            WebView.setWebContentsDebuggingEnabled(false)
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                    if (request.isForMainFrame) { webFailed = true; render() }
                }
                override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                    journey?.pause(); webFailed = true; rendererGone = true
                    (view.parent as? android.view.ViewGroup)?.removeView(view); view.destroy(); render(); return true
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url
                    return !BridgePolicy.trustedPage(u.toString())
                }
            }
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            run {
                TrustedBridge.install(this) { payload, reply ->
                    if (!canAct() || verifyingRoute || confirmation?.isShowing == true || (journey != null && journey?.state != SegmentJourney.State.FINISHED)) {
                        reply.postMessage("요청을 처리할 수 없습니다.")
                    } else {
                        verifyingRoute = true
                        val requestedPage = url
                        status.text = "추천 경로 확인 중"
                        Thread {
                            val result = runCatching { RecommendationVerifier.fetch(payload) }
                            main.post {
                                verifyingRoute = false
                                if (!destroyed && !rendererGone && web.url == requestedPage && canAct() && (journey == null || journey?.state == SegmentJourney.State.FINISHED)) {
                                    result.onSuccess { route ->
                                        val stops = route.points.joinToString(" → ") { it.name }
                                        showConfirm("추천 경로 확인", "웹에서 선택한 코스의 경유지 순서입니다.\n$stops\n${if (route.status == "ROAD_ROUTED") "도로 경로" else "거리·시간 추정"}") {
                                            if (journey == null || journey?.state == SegmentJourney.State.FINISHED) { journey = SegmentJourney(route); render() }
                                        }
                                    }.onFailure { status.text = "추천 경로를 확인하지 못했습니다. 웹에서 코스를 다시 추천받아 주세요." }
                                }
                            }
                        }.start()
                        reply.postMessage("추천 경로 확인 중")
                    }
                }
            }
            loadUrl("https://ravirgo.com/flowad/")
        }
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        restriction = ParkedRestriction(applicationContext) { main.post { if (!destroyed) render() } }
        navi = PleosNavi(applicationContext) { event -> main.post { if (!destroyed) onNaviEvent(event) } }
        navi.connect()
    }

    /** Temporary emulator fixture. Production recommendation ingestion is not connected. */
    private fun prepareExample() {
        if (!BuildConfig.DEBUG || !canAct()) return
        if (journey != null && journey?.state != SegmentJourney.State.FINISHED) {
            status.text = "진행 중인 경로가 있습니다. 앱을 다시 시작하면 경로 확인이 초기화됩니다."
            return
        }
        journey = SegmentJourney(RecommendedRoute(listOf(
            RoutePoint(0, "ORIGIN", "출발", 37.5665, 126.9780),
            RoutePoint(1, "SCENIC_WAYPOINT", "예시 경유 1", 37.5700, 126.9900),
            RoutePoint(2, "SCENIC_WAYPOINT", "예시 경유 2", 37.5750, 127.0000),
            RoutePoint(3, "SCENIC_WAYPOINT", "예시 경유 3", 37.5800, 127.0100),
            RoutePoint(4, "RETURN", "예시 복귀", 37.5665, 126.9780)
        ), "ESTIMATED_NOT_ROAD_ROUTED"))
        render()
    }
    private fun canAct(): Boolean = !destroyed && connected && ::restriction.isInitialized && restriction.canInteract()
    private fun showConfirm(title: String, message: String, onConfirm: () -> Unit) {
        if (!canAct()) { render(); return }
        AlertDialog.Builder(this).setTitle(title).setMessage(message)
            .setNegativeButton("취소", null)
            .setPositiveButton("확인") { _, _ -> if (canAct()) onConfirm() else render() }
            .show().also { confirmation = it }
    }
    private fun requestCurrent() {
        val trip = journey ?: return
        if (!canAct()) return
        val plan = trip.current
        val stops = (plan.waypoints + plan.destination).joinToString(" → ") { it.name }
        showConfirm("내비에 구간 전송", "${trip.index + 1}/${trip.segments.size}구간: $stops\n기존 내비 경로가 변경될 수 있습니다.") {
            try {
                trip.beginRequest()
                destinationMatched = false
                waypointsMatched = false
                waypointReviewRequired = false
                waypointUserConfirmed = false
                awaitingWaypoints = false
                arrivalName = null
                awaitingDestination = false
                val token = ++generation
                navi.request(plan)
                main.postDelayed({
                    if (!destroyed && token == generation && trip.state == SegmentJourney.State.REQUESTING) {
                        trip.pause(); awaitingDestination = false; status.text = "내비 응답을 확인하지 못했습니다. 경로를 다시 확인하세요."; render()
                    }
                }, 30000)
            } catch (_: Exception) { trip.pause(); generation++; status.text = "경로 요청 실패" }
            render()
        }
    }
    private fun onNaviEvent(event: PleosNavi.Event) {
        if (BuildConfig.DEBUG) Log.d("FlowadNavi", "event=${event.javaClass.simpleName}")
        when (event) {
            PleosNavi.Event.Connected -> connected = true
            PleosNavi.Event.ConnectionFailed -> { connected = false; journey?.pause() }
            PleosNavi.Event.SearchStarted -> Unit
            PleosNavi.Event.SearchCompleted -> {
                if (journey?.state == SegmentJourney.State.REQUESTING && !awaitingDestination && !awaitingWaypoints) {
                    awaitingDestination = true
                    awaitingWaypoints = true
                    try { navi.queryDestination() } catch (_: Exception) { journey?.pause(); awaitingDestination = false }
                }
            }
            is PleosNavi.Event.Location -> {
                if (event.latitude.isFinite() && event.latitude in -90.0..90.0 && event.longitude.isFinite() && event.longitude in -180.0..180.0)
                    vehicleReading = vehicleReading.copy(status = "LIVE", observedAt = System.currentTimeMillis(), stale = false, latitude = event.latitude, longitude = event.longitude, locationStatus = "LIVE")
            }
            is PleosNavi.Event.Destination -> {
                val trip = journey
                if (awaitingDestination && trip?.state == SegmentJourney.State.REQUESTING) {
                    awaitingDestination = false
                    val target = trip.current.destination
                    if (abs(event.latitude - target.latitude) < 0.0001 && abs(event.longitude - target.longitude) < 0.0001) {
                        destinationMatched = true
                        finishRouteVerification()
                    } else trip.pause()
                }
            }
            is PleosNavi.Event.Waypoints -> {
                lastWaypointCoordinates = event.coordinates
                val trip = journey
                if (awaitingWaypoints && trip?.state == SegmentJourney.State.REQUESTING) {
                    awaitingWaypoints = false
                    val expected = trip.current.waypoints
                    waypointsMatched = expected.size == event.coordinates.size && expected.zip(event.coordinates).all { (point, coordinates) ->
                        abs(point.latitude - coordinates.first) < 0.0001 && abs(point.longitude - coordinates.second) < 0.0001
                    }
                    if (waypointsMatched) finishRouteVerification()
                    else if (event.coordinates.size == expected.size && event.coordinates.all { it.first == 0.0 && it.second == 0.0 }) {
                        waypointReviewRequired = true
                        generation++
                    } else trip.pause()
                }
            }
            is PleosNavi.Event.Arrived -> {
                if (destinationMatched && journey?.state == SegmentJourney.State.GUIDING) arrivalName = event.name
            }
            PleosNavi.Event.RouteChanged, PleosNavi.Event.RouteCancelled -> {
                if (journey?.state == SegmentJourney.State.GUIDING || journey?.state == SegmentJourney.State.AWAITING_CONFIRMATION) {
                    journey?.pause(); destinationMatched = false; arrivalName = null
                }
            }
            is PleosNavi.Event.Error -> { journey?.pause(); destinationMatched = false; arrivalName = null; generation++ }
        }
        render()
    }
    private fun finishRouteVerification() {
        val trip = journey ?: return
        if (trip.state == SegmentJourney.State.REQUESTING && destinationMatched && waypointsMatched) {
            trip.routingCompleted(); generation++
        }
    }
    private fun render() {
        if (!::status.isInitialized || !::restriction.isInitialized) return
        journey?.let { if (it.state == SegmentJourney.State.FINISHED) journeyStore.clear() else journeyStore.save(it) }
        action.visibility = View.GONE
        discard.visibility = View.GONE
        val safe = restriction.canInteract()
        testButton?.visibility = if (safe) View.VISIBLE else View.GONE
        retryWeb.visibility = if (safe && webFailed) View.VISIBLE else View.GONE
        vehicleButton.visibility = if (safe) View.VISIBLE else View.GONE
        if (!rendererGone) web.visibility = if (safe) View.VISIBLE else View.GONE
        if (!safe) confirmation?.dismiss()
        if (!connected) { status.text = "내비 연결을 기다리는 중이거나 연결에 실패했습니다."; return }
        if (!safe) { status.text = "주행 제한이 적용 중이거나 차량 상태를 확인할 수 없습니다."; return }
        val trip = journey
        if (trip == null) { status.text = "선택된 추천 경로가 없습니다. 웹에서 코스를 선택해 주세요."; return }
        when (trip.state) {
            SegmentJourney.State.READY, SegmentJourney.State.FAILED -> {
                status.text = "${trip.index + 1}/${trip.segments.size}구간 · 목적지 ${trip.current.destination.name}"
                action.visibility = View.VISIBLE; action.text = "이 구간 내비로 보내기"; action.setOnClickListener { requestCurrent() }
            }
            SegmentJourney.State.REQUESTING -> {
                if (waypointReviewRequired && destinationMatched) {
                    status.text = "내비가 경유지 좌표를 0,0으로 반환해 자동 검증할 수 없습니다."
                    action.visibility = View.VISIBLE; action.text = "차량에서 경유지 확인"
                    action.setOnClickListener {
                        val points = trip.current.waypoints.joinToString(" → ") { it.name }
                        showConfirm("차량 경유지 확인", "차량 내비 화면에 경유지가 다음 순서로 설정돼 있는지 직접 확인했나요?\n$points\n자동 검증 결과가 아니라 사용자 확인으로 기록됩니다.") {
                            if (trip.state == SegmentJourney.State.REQUESTING && waypointReviewRequired && destinationMatched) {
                                waypointUserConfirmed = true; waypointsMatched = true; waypointReviewRequired = false
                                finishRouteVerification(); render()
                            }
                        }
                    }
                } else status.text = "내비 경로 탐색 및 목적지 확인 중"
            }
            SegmentJourney.State.GUIDING -> {
                val arrived = arrivalName
                if (arrived == null) status.text = "${trip.current.destination.name}까지 안내 중 · ${if (waypointUserConfirmed) "경유지 사용자 확인 · " else ""}도착 알림 대기"
                else {
                    status.text = "내비 도착 알림: $arrived · ${trip.current.destination.name} 도착 여부를 확인해 주세요."
                    action.visibility = View.VISIBLE; action.text = "현재 구간 도착 확인"
                    action.setOnClickListener {
                        showConfirm("도착 확인", "${trip.current.destination.name}에 실제로 도착했나요? 내비 도착 알림: $arrived") {
                            if (trip.state == SegmentJourney.State.GUIDING && destinationMatched && arrivalName != null) {
                                trip.destinationArrived(trip.current.destination.order); arrivalName = null; destinationMatched = false; render()
                            }
                        }
                    }
                }
            }
            SegmentJourney.State.AWAITING_CONFIRMATION -> {
                status.text = "구간 도착 확인됨 · 다음 구간을 준비할 수 있습니다."
                action.visibility = View.VISIBLE; action.text = "다음 구간 확인"
                action.setOnClickListener { if (canAct() && trip.state == SegmentJourney.State.AWAITING_CONFIRMATION) { trip.confirmNext(); render() } }
            }
            SegmentJourney.State.FINISHED -> status.text = "마지막 복귀 지점 도착을 확인했습니다."
            SegmentJourney.State.PAUSED -> {
                discard.visibility = View.VISIBLE
                status.text = "저장된 ${trip.index + 1}/${trip.segments.size}구간 · 내비 상태를 다시 확인해 주세요."
                action.visibility = View.VISIBLE; action.text = "저장된 구간 다시 확인"
                action.setOnClickListener {
                    showConfirm("경로 다시 확인", "현재 내비 경로와 ${trip.current.destination.name}을 확인한 후 이 구간을 다시 보낼 수 있습니다.") {
                        trip.resumeForResend(); render()
                    }
                }
            }
        }
    }
    override fun onDestroy() {
        destroyed = true
        confirmation?.dismiss()
        main.removeCallbacksAndMessages(null)
        generation++
        runCatching { vehicleAdapter?.close() }
        if (::navi.isInitialized) navi.close()
        if (::restriction.isInitialized) restriction.close()
        if (::web.isInitialized && !rendererGone) { (web.parent as? android.view.ViewGroup)?.removeView(web); web.stopLoading(); web.destroy() }
        super.onDestroy()
    }
}
