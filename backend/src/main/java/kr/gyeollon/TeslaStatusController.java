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
 @GetMapping("/status") public ResponseEntity<Map<String,Object>> status(HttpServletRequest req){HttpSession h=req.getSession();var s=session(h);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("connection",integration.connected(s)?"CONNECTED":"NOT_CONNECTED","locationReady",req.isSecure()&&integration.locationReady(s),"navigation",commandConfigured?"SINGLE_DESTINATION":"NOT_CONFIGURED","csrf",csrf(h),"secure",req.isSecure(),"message","전체 경유지 일괄 전송은 미지원입니다. 단일 목적지 교체만 지원합니다."));}
 @PostMapping("/authorize") public ResponseEntity<Map<String,String>> authorize(HttpServletRequest req,@RequestParam(defaultValue="false") boolean location,@RequestParam(defaultValue="false") boolean commands,@RequestParam(defaultValue="") String returnTo)throws TeslaIntegration.Failure {verify(req);req.getSession().setAttribute("tesla_return","check".equals(returnTo)?"/tesla-check.html":"/");return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("url",integration.begin(session(req.getSession()),location,commands)));}
 @GetMapping("/callback") public ResponseEntity<Void> callback(HttpServletRequest req,@RequestParam(required=false) String state,@RequestParam(required=false) String code,@RequestParam(required=false) String error)throws TeslaIntegration.Failure{requireSecure(req);integration.callback(session(req.getSession()),state,code,error);req.changeSessionId();Object target=req.getSession().getAttribute("tesla_return");req.getSession().removeAttribute("tesla_return");return ResponseEntity.status(303).header("Location",req.getContextPath()+("/tesla-check.html".equals(target)?"/tesla-check.html":"/")).header("Referrer-Policy","no-referrer").cacheControl(CacheControl.noStore()).build();}
 @PostMapping("/disconnect") public ResponseEntity<Void> disconnect(HttpServletRequest req)throws TeslaIntegration.Failure {verify(req);integration.disconnect(session(req.getSession()));req.getSession().invalidate();return ResponseEntity.noContent().build();}
 @PostMapping("/vehicles") public ResponseEntity<?> vehicles(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.vehicles(session(req.getSession())));}
 record Selection(String id){}
 @PostMapping("/select") public ResponseEntity<Void> select(HttpServletRequest req,@RequestBody Selection selection)throws TeslaIntegration.Failure{verify(req);integration.select(session(req.getSession()),selection.id());return ResponseEntity.noContent().build();}
 @PostMapping("/reading") public ResponseEntity<?> reading(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.reading(session(req.getSession())));}
 @PostMapping("/location") public ResponseEntity<?> location(HttpServletRequest req)throws TeslaIntegration.Failure{verify(req);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(integration.location(session(req.getSession())));}

 record PreviewRequest(String courseId,Double latitude,Double longitude){}
 record SendRequest(String planId,int order,boolean replaceDestination){}
 record ConfirmRequest(String planId,int order,boolean matched){}
 enum CommandStatus { NOT_SENT, SENDING, API_ACCEPTED, API_FAILED }
 enum VehicleStatus { VEHICLE_NOT_CONFIRMED, VEHICLE_CONFIRMED }
 static class Plan {
  final String id=UUID.randomUUID().toString();
  final String vehicle;
  final long expires=System.currentTimeMillis()+300000;
  final List<VehicleNavigationAdapter.Stop> stops;
  int attempted;
  CommandStatus status=CommandStatus.NOT_SENT;
  VehicleStatus vehicleStatus=VehicleStatus.VEHICLE_NOT_CONFIRMED;
  boolean pending;
  String error;
  Plan(String vehicle,List<VehicleNavigationAdapter.Stop> stops){this.vehicle=vehicle;this.stops=stops;}
 }
 @PostMapping("/navigation/preview") public ResponseEntity<?> preview(HttpServletRequest req,@RequestBody PreviewRequest input)throws Exception {
  verify(req);
  var pending=pendingPreview(req);
  if(pending!=null)return pending;
  validateCoordinates(input.latitude(),input.longitude());
  String vehicle=integration.selected(session(req.getSession()));
  Routing.Route route=routing.create(input.courseId(),input.latitude(),input.longitude(),input.latitude(),input.longitude(),0);
  if(!"ROAD_ROUTED".equals(route.status()))throw new TeslaIntegration.Failure("ROAD_ROUTE_REQUIRED");
  return savePreview(req,vehicle,route,new TeslaNavigationAdapter().prepare(route).stops());
 }
 record DestinationRequest(String name,String address,Double latitude,Double longitude,Double originLatitude,Double originLongitude){}
 @PostMapping("/navigation/destination/preview") public ResponseEntity<?> destination(HttpServletRequest req,@RequestBody DestinationRequest input)throws Exception {
  verify(req);
  var pending=pendingPreview(req);
  if(pending!=null)return pending;
  if(input.address()==null||input.address().isBlank()||input.address().length()>300)throw new TeslaIntegration.Failure("INVALID_DESTINATION");
  validateCoordinates(input.latitude(),input.longitude());
  validateCoordinates(input.originLatitude(),input.originLongitude());
  String vehicle=integration.selected(session(req.getSession()));
  Routing.Route route=routing.destination(input.name(),input.latitude(),input.longitude(),input.originLatitude(),input.originLongitude());
  return savePreview(req,vehicle,route,List.of(new VehicleNavigationAdapter.Stop(1,"DESTINATION",input.name(),input.latitude(),input.longitude(),input.name()+", "+input.address())));
 }
 private void validateCoordinates(Double latitude,Double longitude)throws Routing.RoutingFailure {
  if(latitude==null||longitude==null)throw new Routing.RoutingFailure("INVALID_WAYPOINT");
  Routing.validCoordinate(latitude,longitude);
 }
 private Plan storedPlan(HttpServletRequest req){
  return req.getSession().getAttribute("tesla_plan") instanceof Plan p?p:null;
 }
 private ResponseEntity<?> pendingPreview(HttpServletRequest req)throws TeslaIntegration.Failure {
  if(!commandConfigured)throw new TeslaIntegration.Failure("COMMAND_NOT_CONFIGURED");
  synchronized(session(req.getSession())){
   Plan p=storedPlan(req);
   return p!=null&&p.pending?commandResponse(p):null;
  }
 }
 private ResponseEntity<?> savePreview(HttpServletRequest req,String vehicle,Routing.Route route,List<VehicleNavigationAdapter.Stop> stops)throws TeslaIntegration.Failure {
  synchronized(session(req.getSession())){
   var pending=pendingPreview(req);
   if(pending!=null)return pending;
   if(!vehicle.equals(integration.selected(session(req.getSession()))))throw new TeslaIntegration.Failure("PLAN_EXPIRED");
   Plan p=new Plan(vehicle,stops);
   req.getSession().setAttribute("tesla_plan",p);
   return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("planId",p.id,"route",route,"stops",p.stops,
    "mode","SINGLE_DESTINATION","multiStopStatus","UNSUPPORTED","status",p.status,"expiresInSeconds",300));
  }
 }
 private ResponseEntity<?> commandResponse(Plan p){
  Map<String,Object> body=new LinkedHashMap<>();
  body.put("planId",p.id);
  body.put("status",p.status);
  body.put("order",p.attempted);
  body.put("destination",p.stops.get(p.attempted-1).name());
  body.put("vehicleStatus",p.vehicleStatus);
  body.put("requiresVehicleCheck",p.pending);
  body.put("automaticallyVerified",false);
  if(p.error!=null)body.put("error",p.error);
  return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
 }
 @PostMapping("/navigation/send") public ResponseEntity<?> send(HttpServletRequest req,@RequestBody SendRequest input)throws TeslaIntegration.Failure {
  verify(req);
  var owner=session(req.getSession());
  synchronized(owner){
   Plan p=storedPlan(req);
   if(p==null||!p.id.equals(input.planId())||p.expires<System.currentTimeMillis()||!p.vehicle.equals(integration.selected(owner)))
    throw new TeslaIntegration.Failure("PLAN_EXPIRED");
   if(p.status!=CommandStatus.NOT_SENT)throw new TeslaIntegration.Failure("DUPLICATE_OR_UNCONFIRMED_COMMAND");
   if(!input.replaceDestination())throw new TeslaIntegration.Failure(p.stops.size()>1?"MULTI_STOP_UNSUPPORTED":"DESTINATION_REPLACEMENT_NOT_CONFIRMED");
   if(input.order()<1||input.order()>p.stops.size())throw new TeslaIntegration.Failure("INVALID_DESTINATION");
   p.attempted=input.order();
   p.status=CommandStatus.SENDING;
   try{
    String outcome=integration.sendDestination(owner,p.stops.get(input.order()-1));
    p.status="REQUEST_ACCEPTED".equals(outcome)?CommandStatus.API_ACCEPTED:CommandStatus.API_FAILED;
    p.pending=!"FAILED".equals(outcome);
    if(p.status==CommandStatus.API_FAILED)p.error=p.pending?"COMMAND_RESULT_UNKNOWN":"COMMAND_REJECTED";
   }catch(TeslaIntegration.Failure e){
    p.status=CommandStatus.API_FAILED;
    p.error=e.code;
    p.pending=Set.of("COMMAND_TIMEOUT","COMMAND_RESULT_UNKNOWN").contains(e.code);
   }
   return commandResponse(p);
  }
 }
 @PostMapping("/navigation/confirm") public ResponseEntity<?> confirm(HttpServletRequest req,@RequestBody ConfirmRequest input)throws TeslaIntegration.Failure {
  verify(req);
  synchronized(session(req.getSession())){
   Plan p=storedPlan(req);
   if(p==null||!p.id.equals(input.planId())||input.order()!=p.attempted||!p.pending)
    throw new TeslaIntegration.Failure("NO_PENDING_COMMAND");
   p.pending=false;
   if(input.matched())p.vehicleStatus=VehicleStatus.VEHICLE_CONFIRMED;
   return commandResponse(p);
  }
 }
 @ExceptionHandler({IllegalArgumentException.class,org.springframework.http.converter.HttpMessageNotReadableException.class}) public ResponseEntity<?> badRequest(Exception e){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("error","INVALID_REQUEST"));}
 @ExceptionHandler(Routing.RoutingFailure.class) public ResponseEntity<?> routingFailure(Routing.RoutingFailure e){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("error",e.code));}
 @ExceptionHandler(TeslaIntegration.Failure.class) public ResponseEntity<Map<String,String>> failure(TeslaIntegration.Failure e){return ResponseEntity.status(e.code.equals("INVALID_CSRF")?403:e.code.equals("HTTPS_REQUIRED")?403:e.code.equals("NOT_CONFIGURED")?503:400).cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer").body(Map.of("error",e.code));}
}
