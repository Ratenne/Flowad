package kr.gyeollon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.config.annotation.*;
import java.time.Instant;
import java.util.*;

@SpringBootApplication
@RestController
public class Application implements WebMvcConfigurer {
    @org.springframework.beans.factory.annotation.Autowired private DynamicApiProxy dynamic;
    @org.springframework.beans.factory.annotation.Autowired private ObjectMapper dynamicMapper;
    @org.springframework.context.annotation.Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean(Routing.RoadProvider.class)
    static Routing.RoadProvider defaultRoadProvider(ObjectMapper mapper, @org.springframework.beans.factory.annotation.Value("${ROAD_ROUTING_URL:}") String url){return url.isBlank()?new Routing.MockProvider():new OsrmRoadProvider(mapper,url);}
    public static void main(String[] args) { SpringApplication.run(Application.class,args); }
    @Override public void addResourceHandlers(ResourceHandlerRegistry r) { r.addResourceHandler("/**").addResourceLocations("file:../dist/", "file:dist/"); }
    @GetMapping("/") public org.springframework.web.servlet.ModelAndView index() { return new org.springframework.web.servlet.ModelAndView("forward:/index.html"); }
    record Weather(String condition, Double temperatureC, Double windMps, Boolean severe, String source, String observedAt) {}
    record Request(Double latitude, Double longitude, Integer availableMinutes, String scenery, String vehicleType, Double batteryPercent, Double estimatedRangeKm, Weather weather, Map<String,Weather> courseWeather, Boolean originSevere, Boolean walking, String departure, Double returnLatitude, Double returnLongitude) {}
    @PostMapping("/api/recommendations") public ResponseEntity<?> recommend(@RequestBody JsonNode req) throws Exception {
        validate(dynamicMapper.treeToValue(req,Request.class)); return dynamic.post("/api/recommendations",req);
    }
    @PostMapping("/api/navigation/verify") public ResponseEntity<?> verifyDynamic(@RequestBody JsonNode req) { return dynamic.post("/api/navigation/verify",req); }
    static String batteryStatus(Request r,int km){if(!"ev".equals(r.vehicleType))return "NOT_APPLICABLE"; if(r.batteryPercent==null||r.estimatedRangeKm==null)return "INSUFFICIENT_INPUT"; return r.batteryPercent-km*1.2/r.estimatedRangeKm*100<15?"CHARGING_MAY_BE_NEEDED":"ESTIMATED_SUFFICIENT";}
    static double distance(double a,double b,double c,double d){double rad=Math.PI/180, y=(c-a)*rad,x=(d-b)*rad,v=Math.pow(Math.sin(y/2),2)+Math.cos(a*rad)*Math.cos(c*rad)*Math.pow(Math.sin(x/2),2);return 12742*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
    static void validateWeather(Weather w){if(w==null)return; if(w.condition==null||!Set.of("sunny","cloudy","rainy").contains(w.condition)||w.temperatureC==null||!Double.isFinite(w.temperatureC)||w.windMps==null||!Double.isFinite(w.windMps)||w.windMps<0||w.source==null||w.source.isBlank()||w.source.length()>100) throw new IllegalArgumentException(); if(w.observedAt!=null) try{Instant.parse(w.observedAt);}catch(Exception e){throw new IllegalArgumentException();}}
    static void validate(Request r){if(r.latitude==null||!Double.isFinite(r.latitude)||Math.abs(r.latitude)>90||r.longitude==null||!Double.isFinite(r.longitude)||Math.abs(r.longitude)>180||r.availableMinutes==null||r.availableMinutes<1||r.availableMinutes>1440||r.scenery==null||!Set.of("all","forest","coast","open").contains(r.scenery)||r.vehicleType==null||!Set.of("ice","ev").contains(r.vehicleType)||(r.batteryPercent!=null&&(!Double.isFinite(r.batteryPercent)||r.batteryPercent<0||r.batteryPercent>100))||(r.estimatedRangeKm!=null&&(!Double.isFinite(r.estimatedRangeKm)||r.estimatedRangeKm<=0||r.estimatedRangeKm>2000)))throw new IllegalArgumentException(); if((r.returnLatitude==null)!=(r.returnLongitude==null)||(r.returnLatitude!=null&&(!Double.isFinite(r.returnLatitude)||Math.abs(r.returnLatitude)>90||!Double.isFinite(r.returnLongitude)||Math.abs(r.returnLongitude)>180)))throw new IllegalArgumentException(); validateWeather(r.weather); if(r.courseWeather!=null){if(r.courseWeather.size()>100)throw new IllegalArgumentException();r.courseWeather.values().forEach(Application::validateWeather);}}
    @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class}) public ResponseEntity<Map<String,String>> badRequest(Exception e){return ResponseEntity.badRequest().body(Map.of("error","Invalid recommendation request"));}
}
