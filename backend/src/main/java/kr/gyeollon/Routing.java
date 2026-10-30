package kr.gyeollon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.*;

/** Provider-neutral model. Geometry is absent unless a provider may return and display it. */
@Service
public class Routing {
    public record Point(int order, String type, String name, double latitude, double longitude, String source, String verification, Double originalSnapDistanceMeters) {}
    public record Coordinate(double latitude, double longitude) {}
    public record Leg(int fromOrder, int toOrder, double distanceKm, int durationSeconds, List<Coordinate> geometry) {}
    public record Route(List<Point> points, List<Leg> legs, double distanceKm, int drivingSeconds, int stopSeconds, int totalSeconds, String status, String provider, String generatedAt, String geometryStatus, String terrainStatus, List<String> warnings) {}
    public interface RoadProvider { ProviderResult route(List<Point> points) throws RoutingFailure; }
    public record ProviderResult(List<Leg> legs, String status, String provider, String geometryStatus) {}
    public static class RoutingFailure extends Exception { public final String code; public RoutingFailure(String code){super(code);this.code=code;} }
    private final JsonNode anchors;
    private final RoadProvider provider;
    public Routing(ObjectMapper mapper,RoadProvider provider) throws Exception { this.anchors=mapper.readTree(getClass().getResourceAsStream("/anchors.json")); this.provider=provider; }
    public Route create(String id,double lat,double lng,double returnLat,double returnLng,int stopMinutes) throws RoutingFailure {
        validCoordinate(lat,lng); validCoordinate(returnLat,returnLng);
        JsonNode course=anchors.path(id); if(!course.isObject()) throw new RoutingFailure("WAYPOINTS_UNAVAILABLE");
        List<Point> points=new ArrayList<>(); List<String> warnings=new ArrayList<>();
        points.add(new Point(0,"ORIGIN","출발지",lat,lng,"USER_INPUT","NOT_VERIFIED",null));
        for(JsonNode a:course.path("anchors")){
            JsonNode xy=a.path("coordinate"); if(!xy.isArray()||xy.size()!=2||!xy.get(0).isNumber()||!xy.get(1).isNumber())throw new RoutingFailure("INVALID_WAYPOINT");
            double x=xy.get(0).asDouble(),y=xy.get(1).asDouble(); validCoordinate(y,x);
            double snap=a.path("snap_distance_m").asDouble(); if(!Double.isFinite(snap)||snap<0)throw new RoutingFailure("INVALID_WAYPOINT");
            String verification=snap>500?"HISTORICAL_SNAP_FAR_ACCESS_UNCERTAIN":"HISTORICAL_SNAP_ACCESS_UNVERIFIED";
            if(snap>500)warnings.add("과거 도로 스냅 거리가 500m를 넘는 경유지가 있어 진입이 불확실합니다.");
            points.add(new Point(points.size(),"SCENIC_WAYPOINT",a.path("label").asText(),y,x,"OSRM/OSM 스냅 ("+course.path("capturedAt").asText()+")",verification,snap));
        }
        if(points.size()<2||points.size()>16)throw new RoutingFailure("WAYPOINT_LIMIT");
        points.add(new Point(points.size(),"RETURN", "복귀 지점",returnLat,returnLng,"USER_INPUT","NOT_VERIFIED",null));
        for(int i=1;i<points.size();i++) if(Application.distance(points.get(i-1).latitude,points.get(i-1).longitude,points.get(i).latitude,points.get(i).longitude)<.001)throw new RoutingFailure("DUPLICATE_ADJACENT_POINTS");
        ProviderResult result=provider.route(List.copyOf(points));
        if(result==null||result.legs()==null||result.legs().size()!=points.size()-1)throw new RoutingFailure("INCOMPLETE_ROUTE");
        double km=0;int seconds=0;
        for(int i=0;i<result.legs().size();i++){ Leg l=result.legs().get(i); if(l==null||l.fromOrder()!=i||l.toOrder()!=i+1||!Double.isFinite(l.distanceKm())||l.distanceKm()<0||l.durationSeconds()<0)throw new RoutingFailure("INCOMPLETE_ROUTE"); km+=l.distanceKm();seconds=Math.addExact(seconds,l.durationSeconds()); }
        if(!"ROAD_ROUTED".equals(result.status())&&!"ESTIMATED_NOT_ROAD_ROUTED".equals(result.status()))throw new RoutingFailure("INVALID_PROVIDER_RESPONSE");
        warnings.add("경유지와 출발·복귀 지점의 현재 진입 가능 여부는 확인되지 않았습니다.");
        return new Route(List.copyOf(points),List.copyOf(result.legs()),Math.round(km*10)/10.0,seconds,stopMinutes*60,seconds+stopMinutes*60,result.status(),result.provider(),Instant.now().toString(),result.geometryStatus(),terrainStatus(id),List.copyOf(warnings));
    }
    static String terrainStatus(String id){
        if(!id.matches("[a-z0-9-]+"))return "UNAVAILABLE";
        return java.nio.file.Files.isRegularFile(java.nio.file.Path.of("../dist/terrain",id+".json"))||java.nio.file.Files.isRegularFile(java.nio.file.Path.of("dist/terrain",id+".json")) ? "HIGHLIGHT_ONLY" : "UNAVAILABLE";
    }
    static void validCoordinate(double lat,double lng)throws RoutingFailure {if(!Double.isFinite(lat)||!Double.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw new RoutingFailure("INVALID_WAYPOINT");}
    /** Straight-distance estimate only, never a mock road geometry or a routing success. */
    static class MockProvider implements RoadProvider {
        public ProviderResult route(List<Point> p){List<Leg> legs=new ArrayList<>();for(int i=0;i<p.size()-1;i++){Point a=p.get(i),b=p.get(i+1);double km=Application.distance(a.latitude,a.longitude,b.latitude,b.longitude)*1.18;legs.add(new Leg(i,i+1,Math.round(km*100)/100.0,(int)Math.ceil(km/55*3600),null));}return new ProviderResult(legs,"ESTIMATED_NOT_ROAD_ROUTED","mock-straight-line", "NOT_AVAILABLE");}
    }
}
