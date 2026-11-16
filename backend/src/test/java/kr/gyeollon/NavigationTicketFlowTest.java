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
 @Autowired MockMvc mvc; @Autowired ObjectMapper mapper;
 @Test void originalRecommendationResolvesWithoutRecalculation()throws Exception {
  var response=mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content("{\"latitude\":37.5665,\"longitude\":126.978,\"availableMinutes\":480,\"scenery\":\"all\",\"vehicleType\":\"ice\"}"))
   .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store")).andReturn().getResponse();
  JsonNode course=mapper.readTree(response.getContentAsByteArray()).path("courses").get(0);
  String body=mapper.writeValueAsString(java.util.Map.of("ticket",course.path("navigationTicket").asText()));
  var resolved=mvc.perform(post("/api/navigation/resolve").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk()).andReturn().getResponse();
  JsonNode route=mapper.readTree(resolved.getContentAsByteArray()).path("route");
  assertEquals(course.path("route").path("points"),route.path("points"));
  assertEquals(course.path("route").path("status"),route.path("status"));
  mvc.perform(post("/api/navigation/resolve").contentType(MediaType.APPLICATION_JSON).content("{\"ticket\":\"forged\"}")).andExpect(status().isBadRequest());
 }
}
