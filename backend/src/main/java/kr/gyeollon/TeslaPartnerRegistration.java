package kr.gyeollon;

import com.fasterxml.jackson.databind.*;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.*;

/** Disabled unless explicitly enabled by the service operator. No public registration endpoint. */
@Component
@ConditionalOnProperty(name="TESLA_REGISTER_PARTNER",havingValue="true")
public class TeslaPartnerRegistration implements ApplicationRunner {
 static final String DOMAIN="ravirgo.com", KEY_PATH="/.well-known/appspecific/com.tesla.3p.public-key.pem";
 private final String id,secret; private final ObjectMapper mapper;
 public TeslaPartnerRegistration(@Value("${TESLA_CLIENT_ID:}") String id,@Value("${TESLA_CLIENT_SECRET:}") String secret,ObjectMapper mapper){this.id=id;this.secret=secret;this.mapper=mapper;}
 record Reply(int status,String body){@Override public String toString(){return "[redacted partner response]";}}
 interface Gateway {Reply published()throws Exception;Reply token()throws Exception;Reply registered(String token)throws Exception;Reply register(String token)throws Exception;}
 @Override public void run(ApplicationArguments args){
  String result;
  try{if(id.isBlank()||secret.isBlank())throw new IllegalStateException();
   String key=new String(Objects.requireNonNull(getClass().getResourceAsStream("/tesla-partner-public-key.txt")).readAllBytes(),StandardCharsets.US_ASCII);
   result=register(new HttpGateway(),key,mapper);
  }catch(Exception e){result="FAILED_NO_AUTOMATIC_RETRY";}
  // Never log upstream bodies, credentials, tokens, or exception messages.
  System.out.println("TESLA_PARTNER_REGISTRATION="+result);
 }
 static String register(Gateway g,String expected,ObjectMapper mapper)throws Exception{
  byte[] der=decode(expected);ECPublicKey key=(ECPublicKey)KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
  if(key.getParams().getCurve().getField().getFieldSize()!=256) return "INVALID_PUBLIC_KEY";
  Reply published=g.published();if(published.status()!=200||!Arrays.equals(der,decode(published.body())))return "PUBLISHED_KEY_MISMATCH";
  Reply auth=g.token();if(auth.status()!=200)return "TOKEN_HTTP_"+auth.status();
  String token=mapper.readTree(auth.body()).path("access_token").asText("");if(token.isBlank())return "TOKEN_INVALID";
  Reply existing=g.registered(token);
  if(existing.status()==200)return containsKey(mapper.readTree(existing.body()),der)?"ALREADY_REGISTERED":"EXISTING_KEY_UNCONFIRMED";
  if(existing.status()!=404&&existing.status()!=412&&!(existing.status()==403&&"NOT_REGISTERED".equals(reason(existing,mapper))))return "KEY_LOOKUP_HTTP_"+existing.status()+"_"+reason(existing,mapper);
  Reply sent=g.register(token);if(sent.status()<200||sent.status()>=300)return "REGISTER_HTTP_"+sent.status()+"_"+reason(sent,mapper);
  Reply verified=g.registered(token);
  return verified.status()==200&&containsKey(mapper.readTree(verified.body()),der)?"REGISTERED_AND_VERIFIED":"REGISTERED_VERIFICATION_REQUIRED";
 }
 static byte[] decode(String text){try{return Base64.getDecoder().decode(text.replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replaceAll("\\s", ""));}catch(IllegalArgumentException e){return new byte[0];}}
 static String reason(Reply reply,ObjectMapper mapper){
  try{JsonNode n=mapper.readTree(reply.body());String e=(n.path("error").asText("")+" "+n.path("error_description").asText("")).toLowerCase(Locale.ROOT);
   if(e.contains("missing scopes")||e.contains("insufficient_scope"))return "MISSING_SCOPES";
   if(e.contains("not registered")||e.contains("must be registered")||e.contains("unregistered account"))return "NOT_REGISTERED";
   if(e.contains("out of region")||e.contains("incorrect region"))return "INCORRECT_REGION";
   if(e.contains("payment")||e.contains("billing"))return "BILLING";
   if(e.contains("domain")&&e.contains("allowed"))return "DOMAIN_NOT_ALLOWED";
  }catch(Exception ignored){}return "UNCLASSIFIED";
 }
 static boolean containsKey(JsonNode n,byte[] der)throws GeneralSecurityException{
  if(n.isTextual()){
   if(Arrays.equals(der,decode(n.asText())))return true;
   // Tesla may return the SEC1 uncompressed point as hex instead of PEM/SPKI.
   String text=n.asText();if(text.matches("(?i)04[0-9a-f]{128}")){
    ECPublicKey key=(ECPublicKey)KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
    String hex="04"+String.format("%064x",key.getW().getAffineX())+String.format("%064x",key.getW().getAffineY());return hex.equalsIgnoreCase(text);
   }return false;
  }for(JsonNode c:n)if(containsKey(c,der))return true;return false;
 }
 private class HttpGateway implements Gateway {
  final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
  Reply send(HttpRequest.Builder b)throws Exception{var r=http.send(b.timeout(Duration.ofSeconds(20)).header("User-Agent","Flowad-Tesla-Partner-Setup/1.0").build(),HttpResponse.BodyHandlers.ofString());return new Reply(r.statusCode(),r.body());}
  public Reply published()throws Exception{return send(HttpRequest.newBuilder(URI.create("https://"+DOMAIN+KEY_PATH)).GET());}
  public Reply token()throws Exception{
   String body="grant_type=client_credentials&client_id="+TeslaIntegration.enc(id)+"&client_secret="+TeslaIntegration.enc(secret)+"&audience="+TeslaIntegration.enc(TeslaIntegration.AUDIENCE)+"&scope="+TeslaIntegration.enc("vehicle_device_data vehicle_cmds");
   return send(HttpRequest.newBuilder(URI.create(TeslaIntegration.TOKEN)).header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body)));
  }
  public Reply registered(String token)throws Exception{return send(HttpRequest.newBuilder(URI.create(TeslaIntegration.AUDIENCE+"/api/1/partner_accounts/public_key?domain="+DOMAIN)).header("Authorization","Bearer "+token).header("Content-Type","application/json").GET());}
  public Reply register(String token)throws Exception{return send(HttpRequest.newBuilder(URI.create(TeslaIntegration.AUDIENCE+"/api/1/partner_accounts")).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(Map.of("domain",DOMAIN)))));}
 }
}
