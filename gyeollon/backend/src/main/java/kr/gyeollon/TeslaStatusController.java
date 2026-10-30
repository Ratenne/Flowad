package kr.gyeollon;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.security.*;
import java.time.Clock;
import java.util.*;

@RestController @RequestMapping("/api/tesla")
public class TeslaStatusController {
 private static final String SESSION="tesla", CSRF="tesla_csrf";
 private final TeslaIntegration integration; private final SecureRandom random=new SecureRandom();
 public TeslaStatusController(@Value("${TESLA_CLIENT_ID:}") String id,@Value("${TESLA_CLIENT_SECRET:}") String secret,@Value("${TESLA_REDIRECT_URI:}") String redirect,ObjectMapper mapper){integration=new TeslaIntegration(id,secret,redirect,new TeslaIntegration.HttpGateway(mapper),Clock.systemUTC());}
 private TeslaIntegration.Session session(HttpSession h){synchronized(h){var s=(TeslaIntegration.Session)h.getAttribute(SESSION);if(s==null){s=new TeslaIntegration.Session();h.setAttribute(SESSION,s);}return s;}}
 private String csrf(HttpSession s){synchronized(s){String t=(String)s.getAttribute(CSRF);if(t==null){byte[] bytes=new byte[32];random.nextBytes(bytes);t=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);s.setAttribute(CSRF,t);}return t;}}
 private void requireSecure(HttpServletRequest req) throws TeslaIntegration.Failure {if(!req.isSecure())throw new TeslaIntegration.Failure("HTTPS_REQUIRED");}
 private void verify(HttpServletRequest req)throws TeslaIntegration.Failure{requireSecure(req);String a=(String)req.getSession().getAttribute(CSRF),b=req.getHeader("X-CSRF-Token");if(a==null||b==null||!MessageDigest.isEqual(a.getBytes(java.nio.charset.StandardCharsets.UTF_8),b.getBytes(java.nio.charset.StandardCharsets.UTF_8)))throw new TeslaIntegration.Failure("INVALID_CSRF");}
 @GetMapping("/status") public ResponseEntity<Map<String,Object>> status(HttpServletRequest req){HttpSession h=req.getSession();return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("connection",integration.connected(session(h))?"CONNECTED":"NOT_CONNECTED","navigation","UNSUPPORTED","csrf",csrf(h),"secure",req.isSecure(),"message","실제 도로 경로 및 Tesla 경유지 명세 확인 전에는 내비 전송을 사용할 수 없습니다."));}
 @PostMapping("/authorize") public ResponseEntity<Map<String,String>> authorize(HttpServletRequest req,@RequestParam(defaultValue="false") boolean location)throws TeslaIntegration.Failure {verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("url",integration.begin(session(req.getSession()),location)));}
 @GetMapping("/callback") public ResponseEntity<Void> callback(HttpServletRequest req,@RequestParam(required=false) String state,@RequestParam(required=false) String code,@RequestParam(required=false) String error)throws TeslaIntegration.Failure{requireSecure(req);integration.callback(session(req.getSession()),state,code,error);req.changeSessionId();return ResponseEntity.status(303).header("Location","/").header("Referrer-Policy","no-referrer").cacheControl(CacheControl.noStore()).build();}
 @PostMapping("/disconnect") public ResponseEntity<Void> disconnect(HttpServletRequest req)throws TeslaIntegration.Failure {verify(req);integration.disconnect(session(req.getSession()));req.getSession().invalidate();return ResponseEntity.noContent().build();}
 @PostMapping("/vehicles") public ResponseEntity<?> vehicles(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.vehicles(session(req.getSession())));}
 record Selection(String id){}
 @PostMapping("/select") public ResponseEntity<Void> select(HttpServletRequest req,@RequestBody Selection selection)throws TeslaIntegration.Failure{verify(req);integration.select(session(req.getSession()),selection.id());return ResponseEntity.noContent().build();}
 @PostMapping("/reading") public ResponseEntity<?> reading(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.reading(session(req.getSession())));}
 @PostMapping("/location") public ResponseEntity<?> location(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.location(session(req.getSession())));}
 @ExceptionHandler(TeslaIntegration.Failure.class) public ResponseEntity<Map<String,String>> failure(TeslaIntegration.Failure e){return ResponseEntity.status(e.code.equals("INVALID_CSRF")?403:e.code.equals("HTTPS_REQUIRED")?403:e.code.equals("NOT_CONFIGURED")?503:400).cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer").body(Map.of("error",e.code));}
}
