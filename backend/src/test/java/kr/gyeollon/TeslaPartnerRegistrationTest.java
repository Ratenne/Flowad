package kr.gyeollon;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class TeslaPartnerRegistrationTest {
 final ObjectMapper mapper=new ObjectMapper();
 String pem()throws Exception{var g=KeyPairGenerator.getInstance("EC");g.initialize(new ECGenParameterSpec("secp256r1"));return "-----BEGIN PUBLIC KEY-----\n"+Base64.getEncoder().encodeToString(g.generateKeyPair().getPublic().getEncoded())+"\n-----END PUBLIC KEY-----\n";}
 class Fake implements TeslaPartnerRegistration.Gateway {
  String expected,published;int lookup=404,auth=200,post=200,lookups=0,tokenCalls=0,posts=0;
  Fake(String p){expected=p;published=p;}
  public TeslaPartnerRegistration.Reply published(){return new TeslaPartnerRegistration.Reply(200,published);}
  public TeslaPartnerRegistration.Reply token(){tokenCalls++;return new TeslaPartnerRegistration.Reply(auth,"{\"access_token\":\"test-token\"}");}
  public TeslaPartnerRegistration.Reply registered(String token)throws Exception{assertEquals("test-token",token);lookups++;return new TeslaPartnerRegistration.Reply(posts>0?200:lookup,mapper.writeValueAsString(Map.of("response",Map.of("public_key",expected))));}
  public TeslaPartnerRegistration.Reply register(String token){assertEquals("test-token",token);posts++;return new TeslaPartnerRegistration.Reply(post,"{}");}
 }
 @Test void disabledUnlessOperatorEnablesIt(){new org.springframework.boot.test.context.runner.ApplicationContextRunner().withBean(ObjectMapper.class).withUserConfiguration(TeslaPartnerRegistration.class).run(c->assertTrue(c.getBeansOfType(TeslaPartnerRegistration.class).isEmpty()));}
 @Test void matchingPublishedKeyBeforeCredentialUse()throws Exception{String key=pem();var f=new Fake(key);f.published=pem();assertEquals("PUBLISHED_KEY_MISMATCH",TeslaPartnerRegistration.register(f,key,mapper));assertEquals(0,f.tokenCalls);assertEquals(0,f.posts);}
 @Test void registerOnlyMissingPartnerAndVerify()throws Exception{String key=pem();var f=new Fake(key);assertEquals("REGISTERED_AND_VERIFIED",TeslaPartnerRegistration.register(f,key,mapper));assertEquals(1,f.posts);assertEquals(2,f.lookups);}
 @Test void neverReplaceExistingKey()throws Exception{String key=pem();var f=new Fake(key);f.lookup=200;assertEquals("ALREADY_REGISTERED",TeslaPartnerRegistration.register(f,key,mapper));assertEquals(0,f.posts);f.expected=pem();assertEquals("EXISTING_KEY_UNCONFIRMED",TeslaPartnerRegistration.register(f,key,mapper));assertEquals(0,f.posts);}
 @Test void errorsDoNotCauseRegistrationOrRetry()throws Exception{String key=pem();var f=new Fake(key);f.lookup=403;assertEquals("KEY_LOOKUP_HTTP_403",TeslaPartnerRegistration.register(f,key,mapper));assertEquals(0,f.posts);f.lookup=412;f.post=402;assertEquals("REGISTER_HTTP_402",TeslaPartnerRegistration.register(f,key,mapper));assertEquals(1,f.posts);assertEquals("[redacted partner response]",new TeslaPartnerRegistration.Reply(400,"sensitive body").toString());}
}
