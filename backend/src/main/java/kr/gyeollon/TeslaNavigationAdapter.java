package kr.gyeollon;

import org.springframework.stereotype.Component;
import java.util.*;

/** Safe stub: request body, vehicle support and full-round-trip behavior are not established. */
@Component
public class TeslaNavigationAdapter implements VehicleNavigationAdapter {
    @Override public NavigationIntent prepare(Routing.Route route) {
        if(route==null||route.points()==null||route.points().size()<2)throw new IllegalArgumentException("Invalid route");
        var points=route.points();
        if(points.get(0)==null||points.get(points.size()-1)==null||!"ORIGIN".equals(points.get(0).type())||
                !Set.of("RETURN","DESTINATION").contains(points.get(points.size()-1).type()))throw new IllegalArgumentException("Route endpoints missing");
        List<Stop> result=new ArrayList<>();
        Set<Coordinates> seen=new HashSet<>();
        var destination=points.get(points.size()-1);
        seen.add(new Coordinates(destination.latitude(),destination.longitude()));
        for(int i=0;i<points.size();i++){
            Routing.Point p=points.get(i);
            if(p==null||p.order()!=i||!Double.isFinite(p.latitude())||!Double.isFinite(p.longitude())||Math.abs(p.latitude())>90||Math.abs(p.longitude())>180)throw new IllegalArgumentException("Invalid route point");
            if(i>0&&i<points.size()-1&&!"SCENIC_WAYPOINT".equals(p.type())&&!"CHARGING_STOP".equals(p.type()))throw new IllegalArgumentException("Invalid waypoint type");
            if(i>0&&(i==points.size()-1||seen.add(new Coordinates(p.latitude(),p.longitude()))))
                result.add(new Stop(result.size()+1,p.type(),p.name(),p.latitude(),p.longitude()));
        }
        return new NavigationIntent(List.copyOf(result),route.status());
    }
    private record Coordinates(double latitude,double longitude) {
        Coordinates { if(latitude==0)latitude=0; if(longitude==0)longitude=0; }
    }
    /** Deliberately does not issue HTTP requests or pretend to send a command. */
    @Override public Outcome send(NavigationIntent intent) { return Outcome.UNSUPPORTED; }
}
