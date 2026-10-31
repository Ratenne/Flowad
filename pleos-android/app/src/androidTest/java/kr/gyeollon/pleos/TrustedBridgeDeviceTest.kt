package kr.gyeollon.pleos
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
class TrustedBridgeDeviceTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation()
 private fun probe(base: String, content: String): Int {
  val count=AtomicInteger(); val received=CountDownLatch(1); val loaded=CountDownLatch(1); val posted=CountDownLatch(1)
  lateinit var web: WebView
  instrumentation.runOnMainSync {
   web=WebView(instrumentation.targetContext); web.settings.javaScriptEnabled=true
   TrustedBridge.install(web) { _, _ -> count.incrementAndGet(); received.countDown() }
   web.webViewClient=object:WebViewClient() { override fun onPageFinished(view:WebView,url:String) { if (!BridgePolicy.trustedPage(base) || url == base) loaded.countDown() } }
   if (BridgePolicy.trustedPage(base)) web.loadUrl(base) else web.loadDataWithBaseURL(base,content,"text/html","UTF-8",base)
  }
  try {
   assertTrue(loaded.await(45,TimeUnit.SECONDS))
   instrumentation.runOnMainSync { web.evaluateJavascript("if(window.FlowadNative) FlowadNative.postMessage('ticket-test'); typeof FlowadNative;") { result -> android.util.Log.i("FlowadBridgeTest", "page=" + web.url + " object=" + result); posted.countDown() } }
   assertTrue(posted.await(5,TimeUnit.SECONDS)); instrumentation.waitForIdleSync()
   if (BridgePolicy.trustedPage(base)) assertTrue("Trusted main-frame message was not delivered; see FlowadBridgeTest", received.await(5,TimeUnit.SECONDS))
   else Thread.sleep(250)
   return count.get()
  } finally { instrumentation.runOnMainSync { web.destroy() } }
 }
 @Test fun acceptsOnlyTrustedMainPage() {
  assertEquals(1,probe("https://ravirgo.com/flowad/","<html>test</html>"))
  assertEquals(0,probe("https://evil.test/flowad/","<html>test</html>"))
  assertEquals(0,probe("https://ravirgo.com/other/","<html>test</html>"))
 }
}
