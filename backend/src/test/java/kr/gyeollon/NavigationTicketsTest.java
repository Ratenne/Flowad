package kr.gyeollon;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import static org.junit.jupiter.api.Assertions.*;
class NavigationTicketsTest {
 final ObjectMapper mapper=new ObjectMapper();
 final byte[] key=new byte[32];
 final NavigationTickets tickets=new NavigationTickets(mapper,Base64.getEncoder().encodeToString(key));
 Routing.Route route(){ return new Routing.Route(List.of(new Routing.Point(0,"ORIGIN","출발",37,127,"USER_INPUT","NOT_VERIFIED",null),new Routing.Point(1,"RETURN","복귀",37,127,"USER_INPUT","NOT_VERIFIED",null)),List.of(),1,60,0,60,"ROAD_ROUTED","test","now","NONE","NONE",List.of()); }
 @Test void preservesExactPointsAndStatus(){var result=tickets.resolve(tickets.issue("course",route()));assertEquals(route().points(),result.route().points());assertEquals("ROAD_ROUTED",result.route().status());}
 @Test void rejectsTamperedPayloadAndSignature(){String token=tickets.issue("course",route());assertThrows(IllegalArgumentException.class,()->tickets.resolve("A"+token.substring(1)));assertThrows(IllegalArgumentException.class,()->tickets.resolve(token.substring(0,token.length()-3)+"AAA"));}
 @Test void rejectsExpiredEvenWithValidSignature()throws Exception {
  byte[] data=mapper.writeValueAsBytes(new NavigationTickets.Snapshot(1,1,"course",new NavigationTickets.RouteSnapshot(route().points(),route().status())));
  Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));
  String token=Base64.getUrlEncoder().withoutPadding().encodeToString(data)+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(data));
  assertThrows(IllegalArgumentException.class,()->tickets.resolve(token));
 }
 @Test void refusesOversizedAndForeignKeys(){assertThrows(IllegalArgumentException.class,()->tickets.resolve("a".repeat(65537)));assertThrows(IllegalArgumentException.class,()->new NavigationTickets(mapper,"").resolve(tickets.issue("course",route())));}
}
