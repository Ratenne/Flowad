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
 private final Routing routing; private final boolean commandConfigured; private final TeslaIntegration integration; private final SecureRandom random=new SecureRandom();
 @org.springframework.beans.factory.annotation.Autowired
 public TeslaStatusController(@Value("${TESLA_CLIENT_ID:}") String id,@Value("${TESLA_CLIENT_SECRET:}") String secret,@Value("${TESLA_REDIRECT_URI:}") String redirect,@Value("${TESLA_COMMAND_PROXY_URL:}") String proxy,ObjectMapper mapper,Routing routing){this.routing=routing;this.commandConfigured=!id.isBlank()&&!secret.isBlank()&&!redirect.isBlank();integration=new TeslaIntegration(id,secret,redirect,new TeslaIntegration.HttpGateway(mapper,proxy),Clock.systemUTC());}
 TeslaStatusController(TeslaIntegration integration,Routing routing){this.integration=integration;this.routing=routing;this.commandConfigured=true;}
 private TeslaIntegration.Session session(HttpSession h){synchronized(h){var s=(TeslaIntegration.Session)h.getAttribute(SESSION);if(s==null){s=new TeslaIntegration.Session();h.setAttribute(SESSION,s);}return s;}}
 private String csrf(HttpSession s){synchronized(s){String t=(String)s.getAttribute(CSRF);if(t==null){byte[] bytes=new byte[32];random.nextBytes(bytes);t=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);s.setAttribute(CSRF,t);}return t;}}
 private void requireSecure(HttpServletRequest req) throws TeslaIntegration.Failure {if(!req.isSecure())throw new TeslaIntegration.Failure("HTTPS_REQUIRED");}
 private void verify(HttpServletRequest req)throws TeslaIntegration.Failure{requireSecure(req);String a=(String)req.getSession().getAttribute(CSRF),b=req.getHeader("X-CSRF-Token");if(a==null||b==null||!MessageDigest.isEqual(a.getBytes(java.nio.charset.StandardCharsets.UTF_8),b.getBytes(java.nio.charset.StandardCharsets.UTF_8)))throw new TeslaIntegration.Failure("INVALID_CSRF");}
 @GetMapping("/status") public ResponseEntity<Map<String,Object>> status(HttpServletRequest req){HttpSession h=req.getSession();return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("connection",integration.connected(session(h))?"CONNECTED":"NOT_CONNECTED","navigation",commandConfigured?"SINGLE_DESTINATION":"NOT_CONFIGURED","csrf",csrf(h),"secure",req.isSecure(),"message","코스 상세에서 도로 경로 확인 후 목적지를 한 지점씩 전송합니다. 전체 경유지 일괄 전송은 미지원입니다."));}
 @PostMapping("/authorize") public ResponseEntity<Map<String,String>> authorize(HttpServletRequest req,@RequestParam(defaultValue="false") boolean location,@RequestParam(defaultValue="false") boolean commands,@RequestParam(defaultValue="") String returnTo)throws TeslaIntegration.Failure {verify(req);req.getSession().setAttribute("tesla_return","check".equals(returnTo)?"/tesla-check.html":"/");return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("url",integration.begin(session(req.getSession()),location,commands)));}
 @GetMapping("/callback") public ResponseEntity<Void> callback(HttpServletRequest req,@RequestParam(required=false) String state,@RequestParam(required=false) String code,@RequestParam(required=false) String error)throws TeslaIntegration.Failure{requireSecure(req);integration.callback(session(req.getSession()),state,code,error);req.changeSessionId();Object target=req.getSession().getAttribute("tesla_return");req.getSession().removeAttribute("tesla_return");return ResponseEntity.status(303).header("Location",req.getContextPath()+("/tesla-check.html".equals(target)?"/tesla-check.html":"/")).header("Referrer-Policy","no-referrer").cacheControl(CacheControl.noStore()).build();}
 @PostMapping("/disconnect") public ResponseEntity<Void> disconnect(HttpServletRequest req)throws TeslaIntegration.Failure {verify(req);integration.disconnect(session(req.getSession()));req.getSession().invalidate();return ResponseEntity.noContent().build();}
 @PostMapping("/vehicles") public ResponseEntity<?> vehicles(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.vehicles(session(req.getSession())));}
 record Selection(String id){}
 @PostMapping("/select") public ResponseEntity<Void> select(HttpServletRequest req,@RequestBody Selection selection)throws TeslaIntegration.Failure{verify(req);integration.select(session(req.getSession()),selection.id());return ResponseEntity.noContent().build();}
 @PostMapping("/reading") public ResponseEntity<?> reading(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.reading(session(req.getSession())));}
 @PostMapping("/location") public ResponseEntity<?> location(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.location(session(req.getSession())));}

 record PreviewRequest(String courseId,double latitude,double longitude){}
 record SendRequest(String planId,int order){}
 record ConfirmRequest(String planId,int order,boolean matched){}
 static class Plan {String id,vehicle;long expires;List<VehicleNavigationAdapter.Stop> stops;int attempted=0;String outcome="PREPARED";}
 @PostMapping("/navigation/preview") public ResponseEntity<?> preview(HttpServletRequest req,@RequestBody PreviewRequest input)throws Exception {
  verify(req);if(!commandConfigured)throw new TeslaIntegration.Failure("COMMAND_NOT_CONFIGURED");
  HttpSession h=req.getSession();String vehicle=integration.selected(session(h));
  Routing.Route route=routing.create(input.courseId(),input.latitude(),input.longitude(),input.latitude(),input.longitude(),0);
  if(!"ROAD_ROUTED".equals(route.status()))throw new TeslaIntegration.Failure("ROAD_ROUTE_REQUIRED");
  Plan plan=new Plan();plan.id=UUID.randomUUID().toString();plan.vehicle=vehicle;plan.expires=System.currentTimeMillis()+300000;plan.stops=new TeslaNavigationAdapter().prepare(route).stops();h.setAttribute("tesla_plan",plan);
  return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("planId",plan.id,"route",route,"stops",plan.stops,"mode","SINGLE_DESTINATION","expiresInSeconds",300));
 }
 record DestinationRequest(String name,String address,double latitude,double longitude,double originLatitude,double originLongitude){}
 @PostMapping("/navigation/destination/preview") public ResponseEntity<?> destination(HttpServletRequest req,@RequestBody DestinationRequest input)throws Exception {
  verify(req);if(!commandConfigured)throw new TeslaIntegration.Failure("COMMAND_NOT_CONFIGURED");
  if(input.address()==null||input.address().isBlank()||input.address().length()>300)throw new TeslaIntegration.Failure("INVALID_DESTINATION");
  HttpSession h=req.getSession();String vehicle=integration.selected(session(h));
  Routing.Route route=routing.destination(input.name(),input.latitude(),input.longitude(),input.originLatitude(),input.originLongitude());
  Plan p=new Plan();p.id=UUID.randomUUID().toString();p.vehicle=vehicle;p.expires=System.currentTimeMillis()+300000;
  p.stops=List.of(new VehicleNavigationAdapter.Stop(1,"DESTINATION",input.name(),input.latitude(),input.longitude(),input.name()+", "+input.address()));h.setAttribute("tesla_plan",p);
  return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("planId",p.id,"route",route,"stops",p.stops,"expiresInSeconds",300));
 }
 private Plan plan(HttpServletRequest req,String id)throws TeslaIntegration.Failure{
  Object value=req.getSession().getAttribute("tesla_plan");if(!(value instanceof Plan p)||!p.id.equals(id)||p.expires<System.currentTimeMillis()||!p.vehicle.equals(integration.selected(session(req.getSession()))))throw new TeslaIntegration.Failure("PLAN_EXPIRED");return p;
 }
 @PostMapping("/navigation/send") public ResponseEntity<?> send(HttpServletRequest req,@RequestBody SendRequest input)throws TeslaIntegration.Failure {
  verify(req);synchronized(session(req.getSession())){Plan p=plan(req,input.planId());synchronized(p){
   if(input.order()<1||input.order()>p.stops.size()||p.attempted>0)throw new TeslaIntegration.Failure("DUPLICATE_OR_UNCONFIRMED_COMMAND");
   p.attempted=input.order();p.outcome="UNKNOWN";
   try{p.outcome=integration.sendDestination(session(req.getSession()),p.stops.get(input.order()-1));}catch(TeslaIntegration.Failure e){throw e;}
   return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("status",p.outcome,"order",p.attempted,"requiresVehicleCheck",true));
  }}
 }
 @PostMapping("/navigation/confirm") public ResponseEntity<?> confirm(HttpServletRequest req,@RequestBody ConfirmRequest input)throws TeslaIntegration.Failure {
  verify(req);Plan p=plan(req,input.planId());synchronized(p){if(input.order()!=p.attempted||!Set.of("REQUEST_ACCEPTED","UNKNOWN").contains(p.outcome))throw new TeslaIntegration.Failure("NO_PENDING_COMMAND");p.outcome=input.matched()?"USER_CONFIRMED":"USER_REPORTED_MISMATCH";return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("status",p.outcome,"automaticallyVerified",false));}
 }
 @ExceptionHandler({IllegalArgumentException.class,org.springframework.http.converter.HttpMessageNotReadableException.class}) public ResponseEntity<?> badRequest(Exception e){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("error","INVALID_REQUEST"));}
 @ExceptionHandler(Routing.RoutingFailure.class) public ResponseEntity<?> routingFailure(Routing.RoutingFailure e){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("error",e.code));}
 @ExceptionHandler(TeslaIntegration.Failure.class) public ResponseEntity<Map<String,String>> failure(TeslaIntegration.Failure e){return ResponseEntity.status(e.code.equals("INVALID_CSRF")?403:e.code.equals("HTTPS_REQUIRED")?403:e.code.equals("NOT_CONFIGURED")?503:400).cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer").body(Map.of("error",e.code));}
}
