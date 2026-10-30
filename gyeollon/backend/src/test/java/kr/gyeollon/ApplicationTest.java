package kr.gyeollon;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc class ApplicationTest {
 @Autowired MockMvc mvc;
 String valid="{\"latitude\":37.5665,\"longitude\":126.978,\"availableMinutes\":180,\"scenery\":\"forest\",\"vehicleType\":\"ev\"}";
 @Test void normal() throws Exception { mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(valid)).andExpect(status().isOk()).andExpect(jsonPath("$.courses[0].distanceTimeStatus").value("ESTIMATED_NOT_ROAD_ROUTED")).andExpect(jsonPath("$.courses[0].batteryStatus").value("ROAD_ROUTE_REQUIRED")).andExpect(jsonPath("$.courses[0].dataSource.generatedAt").exists()); }
 @Test void invalidAndMissing() throws Exception { for(String body:new String[]{valid.replace("37.5665","91"),"{}",valid.replace("126.978","181")}) mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest()); }
 @Test void locationAffectsResults() throws Exception {
  String seoul=mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(valid)).andReturn().getResponse().getContentAsString();
  String busan=mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(valid.replace("37.5665","35.1796").replace("126.978","129.0756"))).andReturn().getResponse().getContentAsString();
  org.junit.jupiter.api.Assertions.assertNotEquals(seoul, busan);
  org.junit.jupiter.api.Assertions.assertTrue(busan.contains("busan-"));
 }
 @Test void empty() throws Exception { mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(valid.replace("180","1"))).andExpect(status().isOk()).andExpect(jsonPath("$.courses.length()").value(0)).andExpect(jsonPath("$.timeExcluded").value(10)); }
}
