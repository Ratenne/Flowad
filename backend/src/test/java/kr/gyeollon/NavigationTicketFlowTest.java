package kr.gyeollon;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc class NavigationTicketFlowTest {
 @Autowired MockMvc mvc; @Autowired ObjectMapper mapper; @Autowired NavigationTickets tickets;
 @Test void originalRecommendationResolvesWithoutRecalculation()throws Exception {
  var points=java.util.List.of(new Routing.Point(0,"ORIGIN","테스트 출발",37.5,127,"TEST","TEST_ONLY",null),new Routing.Point(1,"SCENIC_WAYPOINT","동적 공개 명소",37.51,127.01,"TEST","POSSIBLE_ACCESS",null),new Routing.Point(2,"RETURN","테스트 복귀",37.5,127,"TEST","TEST_ONLY",null));
  var fixture=new Routing.Route(points,java.util.List.of(),3,600,600,1200,"ROAD_ROUTED","MOCK_ONLY",java.time.Instant.now().toString(),"PROVIDER_GEOMETRY","DYNAMIC_ROUTE",java.util.List.of());
  JsonNode course=mapper.valueToTree(java.util.Map.of("route",fixture,"navigationTicket",tickets.issue("dyn-never-in-catalog",fixture)));
  String body=mapper.writeValueAsString(java.util.Map.of("ticket",course.path("navigationTicket").asText()));
  var resolved=mvc.perform(post("/api/navigation/resolve").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk()).andReturn().getResponse();
  JsonNode route=mapper.readTree(resolved.getContentAsByteArray()).path("route");
  assertEquals(course.path("route").path("points"),route.path("points"));
  assertEquals(course.path("route").path("status"),route.path("status"));
  mvc.perform(post("/api/navigation/resolve").contentType(MediaType.APPLICATION_JSON).content("{\"ticket\":\"forged\"}")).andExpect(status().isBadRequest());
 }
}
