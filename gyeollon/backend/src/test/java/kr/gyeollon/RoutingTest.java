package kr.gyeollon;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class RoutingTest {
 final ObjectMapper mapper=new ObjectMapper();
 @Test void roundTripIncludesAllOrderedLegsAndReturn() throws Exception {
  Routing r=new Routing(mapper,new Routing.MockProvider()); var route=r.create("yangpyeong",37.5665,126.978,37.5665,126.978,35);
  assertEquals("ESTIMATED_NOT_ROAD_ROUTED",route.status()); assertEquals("ORIGIN",route.points().get(0).type()); assertEquals("RETURN",route.points().get(route.points().size()-1).type());
  assertEquals(route.points().get(0).latitude(),route.points().get(route.points().size()-1).latitude());
  assertEquals(route.points().size()-1,route.legs().size()); for(int i=0;i<route.legs().size();i++){assertEquals(i,route.legs().get(i).fromOrder());assertEquals(i+1,route.legs().get(i).toOrder());assertNull(route.legs().get(i).geometry());}
  assertEquals("HIGHLIGHT_ONLY",route.terrainStatus()); assertEquals("UNAVAILABLE",Routing.terrainStatus("missing"));
 }
 @Test void rejectedCoordinatesAndMissingWaypoints() throws Exception {Routing r=new Routing(mapper,new Routing.MockProvider());assertEquals("INVALID_WAYPOINT",assertThrows(Routing.RoutingFailure.class,()->r.create("paju",91,0,0,0,0)).code);assertEquals("WAYPOINTS_UNAVAILABLE",assertThrows(Routing.RoutingFailure.class,()->r.create("missing",0,0,0,0,0)).code);}
 @Test void providerFailureAndIncompleteResultsAreNotSuccess() throws Exception {
  Routing fail=new Routing(mapper,p->{throw new Routing.RoutingFailure("PROVIDER_UNAVAILABLE");}); assertEquals("PROVIDER_UNAVAILABLE",assertThrows(Routing.RoutingFailure.class,()->fail.create("paju",37.5,127,37.5,127,0)).code);
  Routing incomplete=new Routing(mapper,p->new Routing.ProviderResult(List.of(),"ROAD_ROUTED","fake-test","NOT_AVAILABLE")); assertEquals("INCOMPLETE_ROUTE",assertThrows(Routing.RoutingFailure.class,()->incomplete.create("paju",37.5,127,37.5,127,0)).code);
 }
 @Test void farHistoricalSnapIsWarned() throws Exception {var route=new Routing(mapper,new Routing.MockProvider()).create("busan-open",35.17,129.07,35.17,129.07,0);assertTrue(route.points().stream().anyMatch(p->p.verification().equals("HISTORICAL_SNAP_FAR_ACCESS_UNCERTAIN")));assertTrue(route.warnings().size()>1);}
}
