package kr.gyeollon;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class TeslaNavigationAdapterTest {
 @Test void preservesWaypointsAndReturnButDoesNotSend() throws Exception {
  var route=new Routing(new ObjectMapper(),new Routing.MockProvider()).create("yangpyeong",37.5665,126.978,37.5665,126.978,35);
  var adapter=new TeslaNavigationAdapter();var intent=adapter.prepare(route);
  assertEquals(route.points().size()-1,intent.stops().size());
  for(int i=0;i<intent.stops().size();i++){assertEquals(i+1,intent.stops().get(i).order());assertEquals(route.points().get(i+1).latitude(),intent.stops().get(i).latitude());assertEquals(route.points().get(i+1).longitude(),intent.stops().get(i).longitude());}
  assertEquals("RETURN",intent.stops().get(intent.stops().size()-1).kind());
  assertEquals("ESTIMATED_NOT_ROAD_ROUTED",intent.sourceStatus());assertEquals(VehicleNavigationAdapter.Outcome.UNSUPPORTED,adapter.send(intent));
 }
 @Test void rejectsMissingRoute(){assertThrows(IllegalArgumentException.class,()->new TeslaNavigationAdapter().prepare(null));}

 @Test void preservesOrderAndKeepsDestinationLast() {
  var adapter=new TeslaNavigationAdapter();
  var origin=point(0,"ORIGIN","origin",1);
  var a=point(1,"SCENIC_WAYPOINT","A",2);
  var b=point(2,"SCENIC_WAYPOINT","B",3);
  var c=point(3,"SCENIC_WAYPOINT","C",4);
  var d=point(4,"RETURN","D",1);
  assertEquals(List.of("A","B","C","D"),adapter.prepare(route(origin,a,b,c,d)).stops().stream().map(VehicleNavigationAdapter.Stop::name).toList());
  var singleVia=adapter.prepare(route(origin,a,point(2,"DESTINATION","D",3)));
  assertEquals(List.of("SCENIC_WAYPOINT","DESTINATION"),singleVia.stops().stream().map(VehicleNavigationAdapter.Stop::kind).toList());
  var deduplicated=adapter.prepare(route(origin,a,point(2,"SCENIC_WAYPOINT","duplicate A",2),
    point(3,"SCENIC_WAYPOINT","duplicate D",1),d));
  assertEquals(List.of("A","D"),deduplicated.stops().stream().map(VehicleNavigationAdapter.Stop::name).toList());
  assertEquals(List.of(1,2),deduplicated.stops().stream().map(VehicleNavigationAdapter.Stop::order).toList());
  assertEquals(VehicleNavigationAdapter.Outcome.UNSUPPORTED,adapter.send(singleVia));
  assertThrows(IllegalArgumentException.class,()->adapter.prepare(route(origin,point(1,"DESTINATION","invalid",Double.NaN))));
 }
 private Routing.Point point(int order,String kind,String name,double latitude){
  return new Routing.Point(order,kind,name,latitude,127,"test","test",null);
 }
 private Routing.Route route(Routing.Point... points){
  return new Routing.Route(List.of(points),List.of(),10,600,0,600,"ROAD_ROUTED","test","test","NONE","UNAVAILABLE",List.of());
 }
}
