package kr.gyeollon;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
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
}
