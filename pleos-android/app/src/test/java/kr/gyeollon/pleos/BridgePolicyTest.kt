package kr.gyeollon.pleos
import org.junit.Assert.*
import org.junit.Test
class BridgePolicyTest {
 @Test fun onlyTrustedTopLevelPage() {
  assertTrue(BridgePolicy.accepts("https://ravirgo.com", "https://ravirgo.com/flowad/", true, 100))
  assertFalse(BridgePolicy.accepts("https://ravirgo.com", "https://ravirgo.com/flowad/", false, 100))
  listOf("http://ravirgo.com/flowad/","https://ravirgo.com.evil.test/flowad/","https://evil@ravirgo.com/flowad/","https://ravirgo.com:8080/flowad/","https://ravirgo.com/other/","file:///flowad/").forEach { assertFalse(BridgePolicy.trustedPage(it)) }
  assertFalse(BridgePolicy.accepts("https://evil.test", "https://ravirgo.com/flowad/", true, 100))
  assertFalse(BridgePolicy.accepts("https://ravirgo.com", "https://ravirgo.com/flowad/", true, 66001))
 }
}
