package kr.gyeollon.pleos
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
object TrustedBridge {
 fun install(view: WebView, receive: (String, JavaScriptReplyProxy) -> Unit): Boolean {
  if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
  WebViewCompat.addWebMessageListener(view,"FlowadNative",setOf("https://ravirgo.com")) { _, message, source, mainFrame, reply ->
   val data = message.data
   if (!BridgePolicy.accepts(source.toString(),view.url,mainFrame,data?.length ?: 0)) { reply.postMessage("허용되지 않은 출처입니다.") }
   else receive(data!!, reply)
  }
  return true
 }
}
