package kr.gyeollon.pleos

import org.junit.Assert.*
import org.junit.Test

class RecommendationVerifierTest {
    private val response = """{"courseId":"test","route":{"status":"ROAD_ROUTED","points":[{"order":0,"type":"ORIGIN","name":"출발","latitude":37.0,"longitude":127.0},{"order":1,"type":"SCENIC_WAYPOINT","name":"경유","latitude":37.1,"longitude":127.1},{"order":2,"type":"RETURN","name":"복귀","latitude":37.0,"longitude":127.0}]}}"""
    @Test fun deviceSupportsOriginScopedBridge() { assertTrue(androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER)) }
    @Test fun acceptsServerRouteAndPreservesOrder() {
        val route = RecommendationVerifier.parseResolved(response)
        assertEquals(listOf("ORIGIN", "SCENIC_WAYPOINT", "RETURN"), route.points.map { it.type })
    }
    @Test fun rejectsUnknownCourseAndInvalidCoordinates() {
        assertThrows(Exception::class.java) { RecommendationVerifier.parseResolved(response.replace("test", "bad/id")) }
        assertThrows(Exception::class.java) { RecommendationVerifier.parseResolved(response.replace("37.1", "137.1")) }
    }
}
