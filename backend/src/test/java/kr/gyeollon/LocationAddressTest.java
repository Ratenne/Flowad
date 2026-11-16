package kr.gyeollon;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class LocationAddressTest {
    private static final LocationAddress.Coordinates POINT = new LocationAddress.Coordinates(38d, 127.5);
    private static String payload(String item, String code) {
        return "flowadJuso({'returnXml':'<results><common><errorCode>" + code
            + "</errorCode><totalCount>" + (item.isEmpty() ? "0" : "1")
            + "</totalCount></common>" + item + "</results>'})";
    }
    @Test void looksUpRoadAddressWithProjectedCoordinatesAndMapKey() {
        var service = new LocationAddress("test+key=", form -> {
            assertTrue(form.contains("confmKey=test%2Bkey%3D"));
            assertTrue(form.contains("pointX=1000000.0&pointY=2000000.0"));
            assertTrue(form.contains("searchType=1"));
            return payload("<juso><roadAddrPart1>테스트로 1 &amp; 2</roadAddrPart1></juso>", "0");
        });
        var result = service.address(POINT);
        assertEquals(200, result.getStatusCode().value());
        assertEquals(new LocationAddress.Match("테스트로 1 & 2", "ROAD_ADDRESS", "JUSO_MAP"), result.getBody());
        assertEquals("no-store", result.getHeaders().getCacheControl());
    }
    @Test void distinguishesNoMatchMissingKeyAndInvalidCoordinatesWithoutSendingRequests() {
        var empty = new LocationAddress("key", form -> payload("", "0"));
        assertEquals(204, empty.address(POINT).getStatusCode().value());
        var unavailable = new LocationAddress("", form -> { fail("Must not contact Juso"); return ""; });
        assertEquals("JUSO_NOT_CONFIGURED", unavailable.address(POINT).getHeaders().getFirst("X-Flowad-Status"));
        assertEquals(204, unavailable.address(new LocationAddress.Coordinates(50d, 10d)).getStatusCode().value());
        assertEquals(400, unavailable.address(new LocationAddress.Coordinates(91d, 127d)).getStatusCode().value());
    }
    @Test void rejectsKeyErrorsMalformedResponsesAndExternalEntities() {
        var denied = new LocationAddress("key", form -> payload("", "E0001"));
        assertEquals("JUSO_KEY_REJECTED", denied.address(POINT).getHeaders().getFirst("X-Flowad-Status"));
        for (String raw : new String[]{"flowadJuso(alert(1))", "bad gateway", payload("<juso/>", "0"),
            payload("<!DOCTYPE x [<!ENTITY x SYSTEM \"file:///secret\">]>", "0"), "x".repeat(262145)}) {
            var invalid = new LocationAddress("key", form -> raw);
            assertEquals("JUSO_INVALID_RESPONSE", invalid.address(POINT).getHeaders().getFirst("X-Flowad-Status"));
        }
        var timeout = new LocationAddress("key", form -> { throw new JusoAddressClient.Failure("JUSO_TIMEOUT"); });
        assertEquals("JUSO_TIMEOUT", timeout.address(POINT).getHeaders().getFirst("X-Flowad-Status"));
    }
}
