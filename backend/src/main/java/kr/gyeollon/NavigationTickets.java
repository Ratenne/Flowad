package kr.gyeollon;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;

/** Signed immutable recommendation snapshot; no command is executed by resolving it. */
@Component
public class NavigationTickets {
    private final ObjectMapper mapper;
    private final byte[] key;
    public record RouteSnapshot(java.util.List<Routing.Point> points, String status) {}
    record Snapshot(int version, long expiresAt, String courseId, RouteSnapshot route) {}
    public record Resolved(String courseId, RouteSnapshot route) {}
    public NavigationTickets(ObjectMapper mapper, @Value("${NAVIGATION_TICKET_SECRET:}") String secret) {
        this.mapper = mapper;
        if (secret.isBlank()) { key = new byte[32]; new SecureRandom().nextBytes(key); }
        else { key = Base64.getDecoder().decode(secret); if(key.length < 32) throw new IllegalArgumentException("Navigation ticket key must be at least 32 bytes"); }
    }
    private byte[] sign(byte[] payload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256")); return mac.doFinal(payload);
    }
    public String issue(String id, Routing.Route route) {
        try {
            byte[] payload=mapper.writeValueAsBytes(new Snapshot(1, Instant.now().getEpochSecond()+300, id, new RouteSnapshot(route.points(),route.status())));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(payload)+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(sign(payload));
        } catch(Exception e) { throw new IllegalStateException("Cannot issue navigation ticket",e); }
    }
    public Resolved resolve(String token) {
        try {
            if(token==null || token.length()>65536) throw new IllegalArgumentException();
            String[] parts=token.split("\\.",-1); if(parts.length!=2)throw new IllegalArgumentException();
            byte[] payload=Base64.getUrlDecoder().decode(parts[0]);
            if(!MessageDigest.isEqual(sign(payload),Base64.getUrlDecoder().decode(parts[1])))throw new IllegalArgumentException();
            Snapshot s=mapper.readValue(payload,Snapshot.class);
            long now=Instant.now().getEpochSecond();
            if(s.version()!=1 || s.expiresAt()<=now || s.expiresAt()>now+300 || s.route()==null || s.courseId()==null)throw new IllegalArgumentException();
            return new Resolved(s.courseId(),s.route());
        } catch(Exception e) { throw new IllegalArgumentException("Invalid or expired navigation ticket"); }
    }
}
