package kr.gyeollon.pleos
import java.net.URI
object BridgePolicy {
    fun trustedPage(url: String?): Boolean = try {
        val u = URI(url ?: "")
        u.scheme == "https" && u.host == "ravirgo.com" && u.userInfo == null && u.port in listOf(-1,443) && u.rawPath.orEmpty().startsWith("/flowad/")
    } catch (_: Exception) { false }
    fun accepts(origin: String, page: String?, mainFrame: Boolean, length: Int): Boolean = try {
        val u=URI(origin)
        mainFrame && length in 1..66000 && u.scheme == "https" && u.host == "ravirgo.com" && u.userInfo == null && u.port in listOf(-1,443) && trustedPage(page)
    } catch (_: Exception) { false }
}
