package kr.gyeollon;

import org.springframework.web.bind.annotation.*;
import java.util.*;

/** Mock-only; straight-line proximity is not a road detour. */
@RestController
@RequestMapping("/api/charging")
public class Charging {
 record Coordinate(double latitude,double longitude) {}
 record Request(String routeStatus,List<Coordinate> geometry) {}
 record Candidate(String name,String source,String connector,String output,String availability,String compatibility,String detour,String straightLineProximity) {}
 record Response(String status,List<Candidate> stations,String note) {}
 record Station(String name,double latitude,double longitude) {}
 interface Provider {List<Station> stations();}
 static class MockProvider implements Provider {public List<Station> stations(){return List.of(new Station("모의 충전소 A",37.56,127.0),new Station("모의 충전소 B",37.74,127.4));}}
 private final Provider provider=new MockProvider();
 @PostMapping("/recommendations") Response recommend(@RequestBody Request request){
  if(request==null||!"ROAD_ROUTED".equals(request.routeStatus())||request.geometry()==null||request.geometry().size()<2)return new Response("ROAD_ROUTE_REQUIRED",List.of(),"실제 도로 경로가 필요합니다.");
  if(request.geometry().size()>20000)throw new IllegalArgumentException();
  for(Coordinate p:request.geometry())if(p==null||!Double.isFinite(p.latitude())||!Double.isFinite(p.longitude())||Math.abs(p.latitude())>90||Math.abs(p.longitude())>180)throw new IllegalArgumentException();
  List<Candidate> candidates=new ArrayList<>();for(Station station:provider.stations()){double nearest=Double.POSITIVE_INFINITY;for(Coordinate p:request.geometry())nearest=Math.min(nearest,Application.distance(p.latitude(),p.longitude(),station.latitude(),station.longitude()));if(nearest<=15)candidates.add(new Candidate(station.name(),"MOCK_FICTITIOUS", "미확인", "미확인", "미확인", "미확인", "미확인", "경로 좌표와 직선거리 약 "+Math.round(nearest)+"km (이탈거리 아님)"));}
  return new Response("MOCK_ONLY",List.copyOf(candidates),"실존 충전소가 아닌 테스트 데이터입니다. 실제 운행에 사용할 수 없습니다.");
 }
}
