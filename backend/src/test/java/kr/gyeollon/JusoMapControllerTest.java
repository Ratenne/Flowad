package kr.gyeollon;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class JusoMapControllerTest {
    @Test
    void rendersCoordinateSearchAtKoreanGridOrigin() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new JusoMapController("test+key=")).build();
        mvc.perform(post("/api/location/juso-map").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("latitude", "38").param("longitude", "127.5"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("Content-Security-Policy", containsString("sandbox allow-scripts")))
            .andExpect(content().string(containsString(
                "confmKey=test%2Bkey%3D&amp;searchType=1&amp;pointX=1000000.0&amp;pointY=2000000.0&amp;skinType=2")));
    }

    @Test
    void unavailableKeyAndInvalidCoordinatesDoNotLoadWidget() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new JusoMapController("")).build();
        mvc.perform(post("/api/location/juso-map").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("latitude", "37.5").param("longitude", "127"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(content().string(not(containsString("<script"))));
        mvc.perform(post("/api/location/juso-map").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("latitude", "NaN").param("longitude", "127"))
            .andExpect(status().isBadRequest())
            .andExpect(content().string(not(containsString("<script"))));
    }
}
