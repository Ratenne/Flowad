package kr.gyeollon.pleos

import android.app.Activity
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.constant.area.DoorValue

/** Emulator-only harness; no WebView-to-native bridge and no navigation command. */
class MainActivity : Activity() {
 private lateinit var navi: NaviHelper
 private lateinit var vehicle: Vehicle
 private lateinit var status: TextView
 private val listener = object : NaviHelperEventListener {
  override fun onRouteStarted(routeStartInfo: RouteStartInfo) { showStatus("에뮬레이터: 경로 탐색 시작 이벤트") }
  override fun onRoutingCompleted() { showStatus("에뮬레이터: 경로 탐색 완료 이벤트") }
  override fun onError(errorCode: NaviErrorCode) { showStatus("에뮬레이터: 내비 요청 오류") }
 }
 private fun showStatus(message: String) = runOnUiThread { status.text = message }
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }
  status=TextView(this).apply { text="Pleos 에뮬레이터 시뮬레이션 · SDK 연결 중"; textSize=18f }
  root.addView(status)
  val test=Button(this).apply { text="에뮬레이터 문 상태 조회"; setOnClickListener {
   vehicle.getDoor().getCurrentDoorPosition(DoorArea(DoorValue.ROW_1_LEFT),
    onComplete={ value -> showStatus("Pleos 에뮬레이터 문 상태 응답: ${value ?: "없음"}") },
    onFailed={ showStatus("Pleos 에뮬레이터 차량 상태 조회 실패") })
  } }
  root.addView(test)
  val web=WebView(this).apply {
   settings.javaScriptEnabled=true; settings.domStorageEnabled=true
   settings.allowFileAccess=false; settings.allowContentAccess=false
   webViewClient=object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
     val u=request.url;return u.scheme!="http" || u.host!="10.0.2.2" || u.port!=8081
    }
   }
   loadUrl("http://10.0.2.2:8081/")
  }
  root.addView(web,LinearLayout.LayoutParams(-1,0,1f));setContentView(root)
  vehicle=Vehicle(applicationContext); vehicle.initialize()
  navi=NaviHelper(applicationContext); navi.initialize(onConnected={navi.addListener(listener);showStatus("Pleos 에뮬레이터: NaviHelper 연결됨 · 경로 요청 미구현")},onFailed={showStatus("Pleos 에뮬레이터: NaviHelper 연결 실패")})
 }
 override fun onDestroy(){navi.removeListener(listener);navi.release();vehicle.release();super.onDestroy()}
}
