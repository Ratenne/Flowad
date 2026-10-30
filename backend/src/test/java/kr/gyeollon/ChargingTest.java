package kr.gyeollon;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class ChargingTest {
 @Test void estimationNeverProducesStations(){var c=new Charging();var r=c.recommend(new Charging.Request("ESTIMATED_NOT_ROAD_ROUTED",List.of()));assertEquals("ROAD_ROUTE_REQUIRED",r.status());assertTrue(r.stations().isEmpty());}
 @Test void mockStationsAreNotClaimedReal(){var c=new Charging();var r=c.recommend(new Charging.Request("ROAD_ROUTED",List.of(new Charging.Coordinate(37.56,127),new Charging.Coordinate(37.57,127.01))));assertEquals("MOCK_ONLY",r.status());assertEquals("MOCK_FICTITIOUS",r.stations().get(0).source());assertEquals("미확인",r.stations().get(0).detour());}
}
