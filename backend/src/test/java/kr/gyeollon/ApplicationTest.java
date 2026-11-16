package kr.gyeollon;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import com.fasterxml.jackson.databind.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc class ApplicationTest {
 @Autowired MockMvc mvc; @Autowired ObjectMapper mapper;
 @MockitoBean DynamicApiProxy proxy;
 String valid="{\"latitude\":37.5665,\"longitude\":126.978,\"availableMinutes\":180,\"scenery\":\"forest\",\"vehicleType\":\"ev\",\"roundTrip\":false,\"requestId\":\"test-request-id\"}";
 @BeforeEach void fixture() throws Exception {doReturn(ResponseEntity.ok().header("Cache-Control","no-store").body(mapper.readTree("{\"courses\":[{\"id\":\"dyn-new\",\"distanceTimeStatus\":\"ROAD_ROUTED\"}]}"))).when(proxy).post(eq("/api/recommendations"),any());}
 @Test void assetsAndContext()throws Exception {mvc.perform(get("/flowad/").contextPath("/flowad")).andExpect(status().isOk());mvc.perform(get("/flowad/app.js").contextPath("/flowad")).andExpect(status().isOk());mvc.perform(post("/flowad/api/recommendations").contextPath("/flowad").contentType(MediaType.APPLICATION_JSON).content(valid)).andExpect(status().isOk()).andExpect(jsonPath("$.courses[0].id").value("dyn-new"));}
 @Test void forwardsDynamicFields()throws Exception {mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(valid)).andExpect(status().isOk());verify(proxy).post(eq("/api/recommendations"),argThat(n->!n.path("roundTrip").asBoolean()&&n.path("requestId").asText().equals("test-request-id")));}
 @Test void invalidInputsDoNotReachEngine()throws Exception {for(String body:new String[]{"{}",valid.replace("37.5665","91"),valid.replace("126.978","181")})mvc.perform(post("/api/recommendations").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());verify(proxy,never()).post(anyString(),any());}
}
