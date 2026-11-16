package kr.gyeollon.pleos

import android.app.AlertDialog
import android.content.Intent
import android.webkit.WebView
import android.widget.TextView
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.io.File

/** Opt-in production HTTPS test using the public Seoul demo origin, never GPS. */
class LiveWebRecommendationTest {
 private val ins=InstrumentationRegistry.getInstrumentation()
 private fun js(web:WebView, script:String):String {
  val done=CountDownLatch(1); var value=""
  ins.runOnMainSync { web.evaluateJavascript(script) { value=it; done.countDown() } }
  check(done.await(10,TimeUnit.SECONDS)); return value
 }
 private fun waitJs(web:WebView,script:String) {
  val until=System.currentTimeMillis()+90000
  while(System.currentTimeMillis()<until) { if(js(web,script)=="true") return; Thread.sleep(250) }
  fail("Web recommendation flow timed out")
 }
 @Test fun webTicketResolvesToSameStopsInNativeScreen() {
  org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("liveRecommendations")=="true")
  val ctx=ins.targetContext
  val prefs=ctx.getSharedPreferences("journey",0); val backup=prefs.getString("current",null)
  prefs.edit().clear().commit()
  val activity=ins.startActivitySync(Intent(ctx,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  try {
   val field=MainActivity::class.java.getDeclaredField("web").apply { isAccessible=true }
   val web=field.get(activity) as WebView
   waitJs(web,"document.readyState==='complete' && typeof window.FlowadNative==='object' && !!document.querySelector('#demoBtn')")
   js(web,"document.querySelector('#demoBtn').click()")
   if (InstrumentationRegistry.getArguments().getString("expectRoutingFailure")=="true") {
    waitJs(web,"!!document.querySelector('#resultStatus') && document.querySelector('#resultStatus').textContent.includes('실패')")
    assertEquals("0",js(web,"document.querySelectorAll('[data-native-route]').length"))
    ins.runOnMainSync {
     val f=MainActivity::class.java.getDeclaredField("journey").apply { isAccessible=true }
     assertNull("Provider failure must not create a journey",f.get(activity))
    }
    File(ctx.filesDir,"live-web-result.txt").writeText("PASS: production HTTPS recommendation failure displayed; no navigation action or journey created. Successful production route transfer remains unverified.\n")
    val bitmap=ins.uiAutomation.takeScreenshot()
    File(ctx.filesDir,"live-web-native.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
    return
   }
   waitJs(web,"document.querySelectorAll('[data-preview]').length>0")
   js(web,"document.querySelector('#selectedDetail').click()")
   waitJs(web,"!!document.querySelector('[data-native-route]')")
   val names=JSONArray(js(web,"Array.from(document.querySelectorAll('#detailContent .timeline b')).map(x=>x.textContent)"))
   js(web,"document.querySelector('[data-native-route]').click()")
   val dialogField=MainActivity::class.java.getDeclaredField("confirmation").apply { isAccessible=true }
   var shown=false
   val until=System.currentTimeMillis()+45000
   while (!shown && System.currentTimeMillis()<until) {
    ins.runOnMainSync { shown=(dialogField.get(activity) as? AlertDialog)?.isShowing == true }
    if(!shown)Thread.sleep(250)
   }
   assertTrue("Native route confirmation was not shown",shown)
   ins.runOnMainSync {
    val dialog=dialogField.get(activity) as AlertDialog
    val message=dialog.findViewById<TextView>(android.R.id.message).text.toString()
    (0 until names.length()).forEach { assertTrue(message.contains(names.getString(it))) }
    dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
    val journeyField=MainActivity::class.java.getDeclaredField("journey").apply { isAccessible=true }
    val journey=journeyField.get(activity) as SegmentJourney
    assertEquals((0 until names.length()).map { names.getString(it) },journey.route.points.map { it.name })
    assertEquals("RETURN",journey.route.points.last().type)
   }
   File(ctx.filesDir,"live-web-result.txt").writeText("PASS: production HTTPS web demo -> signed ticket -> native resolve -> identical ${names.length()} stops -> user confirmation. No vehicle command sent by this test.\n")
   val bitmap=ins.uiAutomation.takeScreenshot()
   File(ctx.filesDir,"live-web-native.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
  } finally { ins.runOnMainSync { activity.finish() }; prefs.edit().putString("current",backup).commit() }
 }
}
