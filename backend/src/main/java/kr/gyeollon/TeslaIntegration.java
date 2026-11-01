package kr.gyeollon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.security.SecureRandom;

/** Request-scoped OAuth and vehicle operations. Secrets and identifiers never leave the server. */
public class TeslaIntegration {
 public static final String AUDIENCE="https://fleet-api.prd.na.vn.cloud.tesla.com";
 public static final String AUTHORIZE="https://auth.tesla.com/oauth2/v3/authorize";
 public static final String TOKEN="https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
 static final String SCOPE="openid offline_access vehicle_device_data";
 public interface Gateway { JsonNode token(Map<String,String> fields) throws Failure; JsonNode get(String path,String token) throws Failure; default JsonNode command(String path,String token,Map<String,Object> body)throws Failure{throw new Failure("COMMAND_NOT_CONFIGURED");} }
 public static class Failure extends Exception { final String code; public Failure(String code){super(code);this.code=code;} }
 public static final class Tokens {
  private String access,refresh; private Instant expires;
  Tokens(String access,String refresh,Instant expires){this.access=access;this.refresh=refresh;this.expires=expires;}
  @Override public String toString(){return "[redacted]";}
 }
 public static final class Session {
  private String state; private Instant stateExpiry; private Tokens tokens; private boolean commands,requestedCommands;
  private final Map<String,String> vehicles=new HashMap<>(); private String selected;
  @Override public String toString(){return "[redacted]";}
 }
 public record Vehicle(String id,String name,String state) {}
 public record Reading(String status, Integer batteryPercent, Double estimatedRangeKm, Long observedAt, boolean stale, Double latitude, Double longitude, String locationStatus) { @Override public String toString(){return "[redacted vehicle data]";} }
 private final String clientId,secret,redirect; private final Gateway gateway; private final Clock clock; private final SecureRandom random=new SecureRandom();
 public TeslaIntegration(String id,String secret,String redirect,Gateway gateway,Clock clock){this.clientId=id;this.secret=secret;this.redirect=redirect;this.gateway=gateway;this.clock=clock;}
 static String enc(String s){return URLEncoder.encode(s,StandardCharsets.UTF_8);}
 private String nonce(){byte[] b=new byte[32];random.nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 public synchronized String begin(Session s,boolean location) throws Failure {return begin(s,location,false);}
 public synchronized String begin(Session s,boolean location,boolean commands) throws Failure {
  if(clientId==null||clientId.isBlank()||secret==null||secret.isBlank()||redirect==null||!redirect.startsWith("https://"))throw new Failure("NOT_CONFIGURED");
  s.commands=false;s.requestedCommands=commands;s.state=nonce();s.stateExpiry=clock.instant().plusSeconds(300);
  return AUTHORIZE+"?prompt=login&response_type=code&client_id="+enc(clientId)+"&redirect_uri="+enc(redirect)+"&scope="+enc(SCOPE+(location?" vehicle_location":"")+(commands?" vehicle_cmds":""))+"&state="+enc(s.state)+"&prompt_missing_scopes=true&require_requested_scopes="+commands;
 }
 public void callback(Session s,String state,String code,String error) throws Failure {
  synchronized(s){String expected=s.state; Instant expires=s.stateExpiry;s.state=null;s.stateExpiry=null;
   if(expected==null||state==null||!java.security.MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),state.getBytes(StandardCharsets.UTF_8))||expires==null||!clock.instant().isBefore(expires))throw new Failure("INVALID_STATE");
   if(error!=null||code==null||code.isBlank())throw new Failure("AUTHORIZATION_DENIED");
   JsonNode data=gateway.token(Map.of("grant_type","authorization_code","client_id",clientId,"client_secret",secret,"redirect_uri",redirect,"audience",AUDIENCE,"code",code));
   s.tokens=readTokens(data);s.commands=s.requestedCommands&&(!data.has("scope")||Arrays.asList(data.path("scope").asText("").split(" ")).contains("vehicle_cmds"));s.requestedCommands=false;s.vehicles.clear();s.selected=null;
  }
 }
 private Tokens readTokens(JsonNode data)throws Failure {String a=data.path("access_token").asText(""),r=data.path("refresh_token").asText("");long n=data.path("expires_in").asLong(0);if(a.isBlank()||r.isBlank()||n<=0)throw new Failure("TOKEN_RESPONSE_INVALID");return new Tokens(a,r,clock.instant().plusSeconds(n));}
 private String access(Session s)throws Failure {if(s.tokens==null)throw new Failure("NOT_CONNECTED");if(!clock.instant().isBefore(s.tokens.expires.minusSeconds(30))){try{s.tokens=readTokens(gateway.token(Map.of("grant_type","refresh_token","client_id",clientId,"refresh_token",s.tokens.refresh)));}catch(Failure e){if("REAUTH_REQUIRED".equals(e.code)||"TOKEN_RESPONSE_INVALID".equals(e.code)){s.tokens=null;s.vehicles.clear();s.selected=null;throw new Failure("REAUTH_REQUIRED");}throw e;}}return s.tokens.access;}
 public void disconnect(Session s){synchronized(s){s.state=null;s.stateExpiry=null;s.tokens=null;s.vehicles.clear();s.selected=null;}}
 public boolean connected(Session s){synchronized(s){return s.tokens!=null;}}
 private Failure stageFailure(String stage,Failure e){return switch(e.code){case "NO_DATA"->new Failure(stage+"_ENDPOINT_UNAVAILABLE");case "PERMISSION_DENIED"->new Failure(stage+"_PERMISSION_DENIED");case "SERVICE_UNAVAILABLE"->new Failure(stage+"_SERVICE_UNAVAILABLE");case "REQUEST_FAILED"->new Failure(stage+"_REQUEST_FAILED");default->e;};}
 static String confirmedRegion(JsonNode data)throws Failure {
  JsonNode r=data.has("response")?data.path("response"):data;
  String base=r.path("fleet_api_base_url").asText("").trim();
  if(base.endsWith("/"))base=base.substring(0,base.length()-1);
  if(AUDIENCE.equals(base))return "ASIA_PACIFIC_NA";
  if("https://fleet-api.prd.eu.vn.cloud.tesla.com".equals(base))throw new Failure("REGION_MISMATCH_EU");
  if("https://fleet-api.prd.cn.vn.cloud.tesla.cn".equals(base))throw new Failure("REGION_MISMATCH_CN");
  if(base.isBlank())throw new Failure("REGION_RESPONSE_INVALID");
  throw new Failure("REGION_BASE_UNRECOGNIZED");
 }
 public String region(Session s)throws Failure{synchronized(s){try{return confirmedRegion(gateway.get("/api/1/users/region",access(s)));}catch(Failure e){handleFailure(s,e);throw stageFailure("REGION",e);}}}
 public List<Vehicle> vehicles(Session s)throws Failure {synchronized(s){JsonNode resp;
  try{resp=gateway.get("/api/1/vehicles",access(s));}catch(Failure e){handleFailure(s,e);throw stageFailure("VEHICLE_LIST",e);}
  JsonNode list=resp.path("response");if(!list.isArray())throw new Failure("INVALID_RESPONSE");
  s.vehicles.clear();s.selected=null;List<Vehicle> result=new ArrayList<>();for(JsonNode v:list){String vin=v.path("vin").asText("");if(vin.isBlank()){s.vehicles.clear();throw new Failure("INVALID_RESPONSE");}String id=nonce();s.vehicles.put(id,vin);result.add(new Vehicle(id,v.path("display_name").asText("Tesla"),v.path("state").asText("unknown")));}return List.copyOf(result);
 }}
 public void select(Session s,String id)throws Failure{synchronized(s){if(!s.vehicles.containsKey(id))throw new Failure("INVALID_VEHICLE");s.selected=id;}}
 public Reading reading(Session s)throws Failure{synchronized(s){if(s.selected==null||!s.vehicles.containsKey(s.selected))throw new Failure("NO_VEHICLE_SELECTED");JsonNode data;
  try{data=gateway.get("/api/1/vehicles/"+enc(s.vehicles.get(s.selected))+"/vehicle_data_cached",access(s));}catch(Failure e){handleFailure(s,e);throw e;}
  JsonNode c=data.path("response").path("charge_state");if(c.isMissingNode()||c.isNull())return new Reading("NO_DATA",null,null,null,true,null,null,"NOT_REQUESTED");
  Integer battery=c.path("battery_level").isNumber()?c.path("battery_level").asInt():null;Double range=c.path("est_battery_range").isNumber()?Math.round(c.path("est_battery_range").asDouble()*1.609344*10)/10.0:null;Long at=c.path("timestamp").isNumber()?c.path("timestamp").asLong():null;
  return new Reading("CACHED",battery,range,at,at==null||clock.instant().toEpochMilli()-at>15*60*1000,null,null,"NOT_AVAILABLE_IN_CACHED_DATA");
 }}
 public Reading location(Session s)throws Failure {synchronized(s){
  if(s.selected==null||!s.vehicles.containsKey(s.selected))throw new Failure("NO_VEHICLE_SELECTED");
  String base="/api/1/vehicles/"+enc(s.vehicles.get(s.selected));
  try {String token=access(s);JsonNode info=gateway.get(base,token).path("response");
   if(info.path("granular_access").path("hide_private").asBoolean(false))throw new Failure("PERMISSION_DENIED");
   if(!"online".equals(info.path("state").asText()))throw new Failure("OFFLINE_OR_ASLEEP");
   JsonNode data=gateway.get(base+"/vehicle_data?endpoints=location_data",token).path("response").path("drive_state");
   if(!data.path("latitude").isNumber()||!data.path("longitude").isNumber())throw new Failure("LOCATION_UNAVAILABLE");
   double lat=data.path("latitude").asDouble(),lon=data.path("longitude").asDouble();if(!Double.isFinite(lat)||!Double.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Failure("LOCATION_UNAVAILABLE");
   Long at=data.path("timestamp").isNumber()?data.path("timestamp").asLong():null;
   return new Reading("LIVE",null,null,at,at==null||clock.instant().toEpochMilli()-at>15*60*1000,lat,lon,"AVAILABLE");
  }catch(Failure e){handleFailure(s,e);throw e;}
 }}
 private void handleFailure(Session s,Failure e){if("REAUTH_REQUIRED".equals(e.code)){s.tokens=null;s.vehicles.clear();s.selected=null;}}
 public String selected(Session s)throws Failure{synchronized(s){if(s.selected==null)throw new Failure("NO_VEHICLE_SELECTED");return s.selected;}}
 public String sendDestination(Session s,VehicleNavigationAdapter.Stop stop)throws Failure{synchronized(s){
  if(!s.commands)throw new Failure("COMMAND_PERMISSION_REQUIRED");
  String vin=s.vehicles.get(selected(s));if(vin==null)throw new Failure("NO_VEHICLE_SELECTED");
  String token=access(s),base="/api/1/vehicles/"+enc(vin);
  try{
   JsonNode info=gateway.get(base,token).path("response");
   if(!"online".equals(info.path("state").asText()))throw new Failure("OFFLINE_OR_ASLEEP");
   JsonNode result=gateway.command(base+"/command/navigation_request",token,Map.of("type","share_ext_content_raw","value",Map.of("android.intent.extra.TEXT",stop.navigationText()),"locale","ko-KR","timestamp_ms",Long.toString(clock.millis())));
   if(!result.path("response").path("result").isBoolean())return "UNKNOWN";
   return result.path("response").path("result").asBoolean()?"REQUEST_ACCEPTED":"FAILED";
  }catch(Failure e){handleFailure(s,e);throw e;}
 }}
 public static class HttpGateway implements Gateway {
  private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();private final ObjectMapper mapper;
  private final String commandBase;
  public HttpGateway(ObjectMapper mapper){this(mapper,"");}
  public HttpGateway(ObjectMapper mapper,String commandBase){this.mapper=mapper;this.commandBase=commandBase.replaceAll("/+$","");if(!commandBase.isBlank()){URI u=URI.create(this.commandBase);if(!"https".equals(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||!u.getPath().isEmpty())throw new IllegalArgumentException("TESLA_COMMAND_PROXY_URL must be an HTTPS origin");}}
  public JsonNode command(String path,String token,Map<String,Object> body)throws Failure{
   // navigation_request is a REST exception in Tesla's official proxy.
   if(!path.endsWith("/command/navigation_request"))throw new Failure("UNSUPPORTED_COMMAND");
   try{return send(HttpRequest.newBuilder(URI.create((commandBase.isBlank()?AUDIENCE:commandBase)+path)).timeout(Duration.ofSeconds(15)).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build());}catch(Failure e){throw e;}catch(Exception e){throw new Failure("COMMAND_RESULT_UNKNOWN");}
  }
  public JsonNode token(Map<String,String> fields)throws Failure{String body=fields.entrySet().stream().map(e->enc(e.getKey())+"="+enc(e.getValue())).reduce((a,b)->a+"&"+b).orElse("");return send(HttpRequest.newBuilder(URI.create(TOKEN)).timeout(Duration.ofSeconds(10)).header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body)).build());}
  public JsonNode get(String path,String token)throws Failure{return send(HttpRequest.newBuilder(URI.create(AUDIENCE+path)).timeout(Duration.ofSeconds(10)).header("Authorization","Bearer "+token).GET().build());}
  // Keep upstream status categories without logging response bodies, tokens or identifiers.
  static void checkStatus(int status,String path)throws Failure{if(status==401)throw new Failure("REAUTH_REQUIRED");if(status==403)throw new Failure("PERMISSION_DENIED");if(status==404)throw new Failure("NO_DATA");if(status==412)throw new Failure(path.endsWith("/vehicle_data_cached")?"NO_DATA":"PRECONDITION_FAILED");if(status==402)throw new Failure("PAYMENT_REQUIRED");if(status==421)throw new Failure("INCORRECT_REGION");if(status==408||status==429||status>=500)throw new Failure("SERVICE_UNAVAILABLE");if(status<200||status>=300)throw new Failure("REQUEST_FAILED");}
  private JsonNode send(HttpRequest request)throws Failure{try{var response=http.send(request,HttpResponse.BodyHandlers.ofString());int status=response.statusCode();checkStatus(status,request.uri().getPath());return mapper.readTree(response.body());}catch(Failure e){throw e;}catch(Exception e){throw new Failure("SERVICE_UNAVAILABLE");}}
 }
}
