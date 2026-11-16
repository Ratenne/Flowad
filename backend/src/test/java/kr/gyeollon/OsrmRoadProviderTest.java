package kr.gyeollon;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class OsrmRoadProviderTest {
 final ObjectMapper mapper=new ObjectMapper();
 final List<Routing.Point> points=List.of(new Routing.Point(0,"ORIGIN","A",37.5,127,"test","",null),new Routing.Point(1,"RETURN","B",37.6,127.1,"test","",null));
 JsonNode response()throws Exception{return mapper.readTree("""
 {"code":"Ok","waypoints":[{"distance":1,"location":[127,37.5]},{"distance":2,"location":[127.1,37.6]}],"routes":[{"legs":[{"distance":18000,"duration":1000,"steps":[{"geometry":{"coordinates":[[127,37.5],[127.1,37.6]]}}]}]}]}
 """);}
 @Test void acceptsCompleteDrivingGeometry()throws Exception{var r=OsrmRoadProvider.parse(response(),points);assertEquals("ROAD_ROUTED",r.status());assertEquals(18,r.legs().get(0).distanceKm());assertEquals(2,r.legs().get(0).geometry().size());}
 @Test void rejectsFarSnapMissingLegsAndGeometry()throws Exception{
  var far=response();((com.fasterxml.jackson.databind.node.ObjectNode)far.path("waypoints").get(0)).put("distance",101);
  assertEquals("WAYPOINT_TOO_FAR_FROM_ROAD",assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.parse(far,points)).code);
  var missing=response();((com.fasterxml.jackson.databind.node.ArrayNode)missing.path("routes").get(0).path("legs")).removeAll();assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.parse(missing,points));
  var geometry=response();((com.fasterxml.jackson.databind.node.ArrayNode)geometry.path("routes").get(0).path("legs").get(0).path("steps")).removeAll();assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.parse(geometry,points));
 }
 @Test void rejectsNegativeMetricsAndOutOfRangeCoordinates()throws Exception{
  var r=response();((com.fasterxml.jackson.databind.node.ObjectNode)r.path("routes").get(0).path("legs").get(0)).put("distance",-1);assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.parse(r,points));
  assertThrows(IllegalArgumentException.class,()->new OsrmRoadProvider(mapper,"http://example.com"));
 }
 @Test void unrouteableCandidateDoesNotBecomeProviderOutage()throws Exception{
  assertEquals("WAYPOINT_TOO_FAR_FROM_ROAD",assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.checkStatus(400,mapper.readTree("{\"code\":\"NoSegment\"}"))).code);
  assertEquals("NO_ROAD_ROUTE",assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.checkStatus(400,mapper.readTree("{\"code\":\"NoRoute\"}"))).code);
  assertEquals("PROVIDER_UNAVAILABLE",assertThrows(Routing.RoutingFailure.class,()->OsrmRoadProvider.checkStatus(503,mapper.readTree("{}"))).code);
 }
}
