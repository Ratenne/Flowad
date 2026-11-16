package kr.gyeollon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;

/** The Java host delegates POI recommendations to the same D1-backed engine.
 * No catalog fallback, session forwarding, retry or vehicle command proxying.
 */
@Component
public class DynamicApiProxy {
 private final String base; private final ObjectMapper mapper;
 private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
 public DynamicApiProxy(@Value("${DYNAMIC_API_BASE_URL:}") String base,ObjectMapper mapper){
  this.base=base.replaceAll("/+$","");this.mapper=mapper;
  if(!base.isBlank()){
   URI u=URI.create(base);
   if(u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!("https".equals(u.getScheme())||("http".equals(u.getScheme())&&java.util.Set.of("localhost","127.0.0.1").contains(u.getHost()))))throw new IllegalArgumentException("Invalid dynamic API base");
  }
 }
 public boolean configured(){return !base.isBlank();}
 public ResponseEntity<?> post(String path,JsonNode body){
  if(!java.util.Set.of("/api/recommendations","/api/navigation/verify","/api/navigation/resolve").contains(path))throw new IllegalArgumentException();
  if(base.isBlank())return ResponseEntity.status(503).body(Map.of("error","DYNAMIC_API_NOT_CONFIGURED"));
  try{
   HttpRequest request=HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(50)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
   HttpResponse<java.io.InputStream> response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
   try(var stream=response.body()){
    byte[] payload=stream.readNBytes(4_000_001);
    if(payload.length>4_000_000)return ResponseEntity.status(503).body(Map.of("error","DYNAMIC_RESPONSE_TOO_LARGE"));
    return ResponseEntity.status(response.statusCode()).header("Cache-Control","no-store").header("Referrer-Policy","no-referrer").body(mapper.readTree(payload));
   }
  }catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();return ResponseEntity.status(503).body(Map.of("error","DYNAMIC_API_UNAVAILABLE"));}
 }
}
