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
    private final JsonNode courses;
    private final Routing routing;
    private final NavigationTickets navigationTickets;
    public Application(ObjectMapper mapper, Routing routing, NavigationTickets navigationTickets) throws Exception { courses = mapper.readTree(getClass().getResourceAsStream("/courses.json")); this.routing=routing; this.navigationTickets=navigationTickets; }
    @org.springframework.context.annotation.Bean
    @org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean(Routing.RoadProvider.class)
    static Routing.RoadProvider defaultRoadProvider(ObjectMapper mapper, @org.springframework.beans.factory.annotation.Value("${ROAD_ROUTING_URL:}") String url){return url.isBlank()?new Routing.MockProvider():new OsrmRoadProvider(mapper,url);}
    public static void main(String[] args) { SpringApplication.run(Application.class,args); }
    @Override public void addResourceHandlers(ResourceHandlerRegistry r) { r.addResourceHandler("/**").addResourceLocations("file:../dist/", "file:dist/"); }
    @GetMapping("/") public org.springframework.web.servlet.ModelAndView index() { return new org.springframework.web.servlet.ModelAndView("forward:/index.html"); }
    record Weather(String condition, Double temperatureC, Double windMps, Boolean severe, String source, String observedAt) {}
    record Request(Double latitude, Double longitude, Integer availableMinutes, String scenery, String vehicleType, Double batteryPercent, Double estimatedRangeKm, Weather weather, Map<String,Weather> courseWeather, Boolean originSevere, Boolean walking, String departure, Double returnLatitude, Double returnLongitude) {}
    record Waypoint(String name, String description) {}
    record DataSource(String course, String distanceTime, String weather, String weatherObservedAt, String generatedAt) {}
    record Result(String id, String name, List<String> reasons, int estimatedRoundTripKm, int estimatedMinutes, List<Waypoint> waypoints, String distanceTimeStatus, String batteryStatus, DataSource dataSource, Routing.Route route, String navigationTicket) {}
    record Response(List<Result> courses, int weatherExcluded, int timeExcluded, int routingFailed, String guidance) {}
    record Candidate(JsonNode course,int km,int minutes,double score,Weather weather,Routing.Route route) {}
    @PostMapping("/api/recommendations") public ResponseEntity<Response> recommend(@RequestBody Request req) {
        validate(req); return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(recommendInternal(req));
    }
    private Response recommendInternal(Request req) { List<Candidate> candidates = new ArrayList<>(); int excluded=0, timeExcluded=0, routingFailed=0;
        for(JsonNode c:courses) {
            double approach=distance(req.latitude,req.longitude,c.path("lat").asDouble(),c.path("lng").asDouble());
            int km=Math.max(12,(int)Math.round(approach*2*1.18+Math.round(c.path("km").asDouble()*.22)));
            int minutes=(int)Math.ceil((km/55.0*60+c.path("walk").asInt()+15)/5)*5;
            if(Boolean.FALSE.equals(req.walking)) minutes-=c.path("walk").asInt();

            Weather w=req.courseWeather==null?null:req.courseWeather.get(c.path("id").asText()); if(w==null) w=req.weather;
            double temp=w==null?22:w.temperatureC, wind=w==null?2:w.windMps;
            String condition=w==null?"sunny":w.condition;
            double shade=c.path("shade").asDouble(),exposure=c.path("exposure").asDouble(),altitude=c.path("altitude").asDouble();
            if(Boolean.TRUE.equals(req.originSevere)||(w!=null&&Boolean.TRUE.equals(w.severe))||(wind>=10&&exposure>=.7)||(condition.equals("rainy")&&altitude>.6)){excluded++;continue;}
            Routing.Route route;
            try { route=routing.create(c.path("id").asText(),req.latitude,req.longitude,req.returnLatitude==null?req.latitude:req.returnLatitude,req.returnLongitude==null?req.longitude:req.returnLongitude,15+(Boolean.FALSE.equals(req.walking)?0:c.path("walk").asInt())); }
            catch(Routing.RoutingFailure e){routingFailed++;if(Set.of("PROVIDER_UNAVAILABLE","PROVIDER_PERMISSION_DENIED","RATE_LIMIT").contains(e.code))break;continue;} catch(ArithmeticException e){routingFailed++;continue;}
            km=(int)Math.round(route.distanceKm()); minutes=(int)Math.ceil(route.totalSeconds()/60.0);
            if(minutes>req.availableMinutes){timeExcluded++;continue;}
            double weather=condition.equals("sunny")?(temp>=28?.25+.7*shade:temp<8?.8-.4*exposure-.2*altitude:.96-.15*shade):condition.equals("cloudy")?.9-.12*altitude:.75-.3*altitude-.15*exposure;
            weather=Math.max(.05,weather-wind/16*exposure*.5);
            double scenery=temp>=28?shade:temp<8?1-altitude:condition.equals("sunny")?.8+exposure*.2:.8;
            double preference=req.scenery.equals("all")?.83:c.path("mood").asText().equals(req.scenery)?1:.24;
            double ease=c.path("ease").asDouble(); if(batteryStatus(req,km).equals("CHARGING_MAY_BE_NEEDED"))ease*=.78;
            double score=Math.round(Math.min(.99,weather*.35+scenery*.25+preference*.2+(ease*.5+Math.max(.3,1-approach/180)*.5)*.1+c.path("novelty").asDouble()*.1+("sunset".equals(req.departure)&&!c.path("scene").asText().equals("forest")?.04:0))*100);
            candidates.add(new Candidate(c,km,minutes,score,w,route));
        }
        candidates.sort(Comparator.comparingDouble(Candidate::score).reversed().thenComparingInt(Candidate::km));
        List<Result> results=new ArrayList<>(); Set<String> moods=new HashSet<>();
        while(!candidates.isEmpty()&&results.size()<3){ candidates.sort(Comparator.comparingDouble((Candidate c)->c.score-(moods.contains(c.course.path("mood").asText())?7:0)).reversed()); Candidate x=candidates.remove(0); moods.add(x.course.path("mood").asText());
            List<Waypoint> points=new ArrayList<>(); for(Routing.Point p:x.route.points())points.add(new Waypoint(p.name(),p.verification()));
            List<String> why=new ArrayList<>(); why.add(x.route.status().equals("ROAD_ROUTED")?"출발지와 왕복 가능 시간을 기준으로 계산했어요.":"출발지와 왕복 가능 시간을 기준으로 추정했어요."); if(!req.scenery.equals("all")&&req.scenery.equals(x.course.path("mood").asText())) why.add("선택한 풍경 취향을 반영했어요."); if(x.weather!=null)why.add("제공된 날씨 조건을 반영했어요.");
            String bs="ev".equals(req.vehicleType)&&!"ROAD_ROUTED".equals(x.route.status())?"ROAD_ROUTE_REQUIRED":batteryStatus(req,x.km); if(bs.equals("ROAD_ROUTE_REQUIRED"))why.add("실제 도로 경로가 없어 충전 필요성을 판단할 수 없어요."); else if(bs.equals("INSUFFICIENT_INPUT"))why.add("배터리 판단에 필요한 입력이 부족해요."); else if(bs.equals("CHARGING_MAY_BE_NEEDED"))why.add("입력값 기준 충전이 필요할 수 있어요.");
            results.add(new Result(x.course.path("id").asText(),x.course.path("name").asText(),why,x.km,x.minutes,points,x.route.status(),bs,new DataSource("내장 예시 코스 10개", x.route.status().equals("ROAD_ROUTED")?x.route.provider():"각 구간 직선거리 × 1.18 및 평균 55km/h 추정",x.weather==null?"없음: 예시 날씨":x.weather.source,x.weather==null?null:x.weather.observedAt,Instant.now().toString()),x.route,navigationTickets.issue(x.course.path("id").asText(),x.route)));
        } return new Response(results,excluded,timeExcluded,routingFailed,results.isEmpty()?(routingFailed>0?"경로 계산에 실패한 후보가 있습니다. 잠시 후 다시 시도하거나 조건을 조정하세요.":"조건에 맞는 코스가 없습니다. 이용 시간을 늘리거나 날씨 조건을 확인하세요."):(results.stream().allMatch(r->r.route.status().equals("ROAD_ROUTED"))?"도로 경로 기준 추천입니다.":"차량 순정 내비의 경로 결과를 받기 전이라 전체 왕복은 추정입니다."));
    }
    static String batteryStatus(Request r,int km){if(!"ev".equals(r.vehicleType))return "NOT_APPLICABLE"; if(r.batteryPercent==null||r.estimatedRangeKm==null)return "INSUFFICIENT_INPUT"; return r.batteryPercent-km*1.2/r.estimatedRangeKm*100<15?"CHARGING_MAY_BE_NEEDED":"ESTIMATED_SUFFICIENT";}
    static double distance(double a,double b,double c,double d){double rad=Math.PI/180, y=(c-a)*rad,x=(d-b)*rad,v=Math.pow(Math.sin(y/2),2)+Math.cos(a*rad)*Math.cos(c*rad)*Math.pow(Math.sin(x/2),2);return 12742*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));}
    static void validateWeather(Weather w){if(w==null)return; if(w.condition==null||!Set.of("sunny","cloudy","rainy").contains(w.condition)||w.temperatureC==null||!Double.isFinite(w.temperatureC)||w.windMps==null||!Double.isFinite(w.windMps)||w.windMps<0||w.source==null||w.source.isBlank()||w.source.length()>100) throw new IllegalArgumentException(); if(w.observedAt!=null) try{Instant.parse(w.observedAt);}catch(Exception e){throw new IllegalArgumentException();}}
    static void validate(Request r){if(r.latitude==null||!Double.isFinite(r.latitude)||Math.abs(r.latitude)>90||r.longitude==null||!Double.isFinite(r.longitude)||Math.abs(r.longitude)>180||r.availableMinutes==null||r.availableMinutes<1||r.availableMinutes>1440||r.scenery==null||!Set.of("all","forest","coast","open").contains(r.scenery)||r.vehicleType==null||!Set.of("ice","ev").contains(r.vehicleType)||(r.batteryPercent!=null&&(!Double.isFinite(r.batteryPercent)||r.batteryPercent<0||r.batteryPercent>100))||(r.estimatedRangeKm!=null&&(!Double.isFinite(r.estimatedRangeKm)||r.estimatedRangeKm<=0||r.estimatedRangeKm>2000)))throw new IllegalArgumentException(); if((r.returnLatitude==null)!=(r.returnLongitude==null)||(r.returnLatitude!=null&&(!Double.isFinite(r.returnLatitude)||Math.abs(r.returnLatitude)>90||!Double.isFinite(r.returnLongitude)||Math.abs(r.returnLongitude)>180)))throw new IllegalArgumentException(); validateWeather(r.weather); if(r.courseWeather!=null){if(r.courseWeather.size()>10)throw new IllegalArgumentException();r.courseWeather.values().forEach(Application::validateWeather);}}
    @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class}) public ResponseEntity<Map<String,String>> badRequest(Exception e){return ResponseEntity.badRequest().body(Map.of("error","Invalid recommendation request"));}
}
