package kr.gyeollon;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
class LocationAddress {
    private final String key;
    private final JusoAddressClient.Gateway gateway;

    @Autowired
    LocationAddress(@Value("${JUSO_MAP_API_KEY:}") String key) { this(key, JusoAddressClient::request); }
    LocationAddress(String key, JusoAddressClient.Gateway gateway) { this.key = key.strip(); this.gateway = gateway; }
    record Coordinates(Double latitude, Double longitude) {}
    record Match(String label, String type, String source) {}

    @PostMapping("/api/location/address")
    ResponseEntity<Match> address(@RequestBody Coordinates coordinates) {
        var noStore = CacheControl.noStore();
        if (!valid(coordinates.latitude(), 90) || !valid(coordinates.longitude(), 180)) {
            return ResponseEntity.badRequest().cacheControl(noStore).build();
        }
        double lat = coordinates.latitude(), lon = coordinates.longitude();
        if (!(lat >= 32 && lat <= 40 && lon >= 124 && lon <= 132)) return ResponseEntity.noContent().cacheControl(noStore).build();
        if (!key.matches("[A-Za-z0-9._+/=-]+")) return unavailable("JUSO_NOT_CONFIGURED");
        try {
            var match = JusoAddressClient.parse(gateway.request(JusoAddressClient.form(key, lat, lon)));
            return match == null ? ResponseEntity.noContent().cacheControl(noStore).build()
                : ResponseEntity.ok().cacheControl(noStore).body(match);
        } catch (JusoAddressClient.Failure e) {
            return unavailable(e.code);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return unavailable("JUSO_UNAVAILABLE");
        } catch (Exception e) {
            return unavailable("JUSO_INVALID_RESPONSE");
        }
    }
    private static ResponseEntity<Match> unavailable(String code) {
        return ResponseEntity.status(503).cacheControl(CacheControl.noStore()).header("X-Flowad-Status", code).build();
    }
    private static boolean valid(Double value, double limit) {
        return value != null && Double.isFinite(value) && Math.abs(value) <= limit;
    }
}
