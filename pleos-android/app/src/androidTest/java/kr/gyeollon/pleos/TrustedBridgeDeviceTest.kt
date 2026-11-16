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
   web.webViewClient=object:WebViewClient() { override fun onPageFinished(view:WebView,url:String) { loaded.countDown() } }
   web.loadDataWithBaseURL(base,content,"text/html","UTF-8",null)
  }
  try {
   assertTrue(loaded.await(15,TimeUnit.SECONDS))
   instrumentation.runOnMainSync { web.evaluateJavascript("if(window.FlowadNative) FlowadNative.postMessage('ticket-test');") { posted.countDown() } }
   assertTrue(posted.await(5,TimeUnit.SECONDS)); instrumentation.waitForIdleSync()
   if (BridgePolicy.trustedPage(base)) assertTrue("Trusted main-frame message was not delivered", received.await(5,TimeUnit.SECONDS))
   else Thread.sleep(250)
   return count.get()
  } finally { instrumentation.runOnMainSync { web.destroy() } }
 }
 @Test fun acceptsOnlyTrustedMainPage() {
  assertEquals(1,probe("https://ravirgo.com/flowad/","<html>test</html>"))
  assertEquals(1,probe("https://ravirgo.com/flowad/", "<iframe srcdoc=\"<script>if(window.FlowadNative)FlowadNative.postMessage('frame');</script>\"></iframe>"))
  assertEquals(0,probe("https://evil.test/flowad/","<html>test</html>"))
  assertEquals(0,probe("https://ravirgo.com/other/","<html>test</html>"))
 }
}
