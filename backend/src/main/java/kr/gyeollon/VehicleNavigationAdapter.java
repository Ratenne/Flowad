package kr.gyeollon;

import java.util.*;

/** Vehicle-independent navigation intent. It is not a Tesla API payload. */
public interface VehicleNavigationAdapter {
    record Stop(int order, String kind, String name, double latitude, double longitude, String navigationText) { public Stop(int order,String kind,String name,double latitude,double longitude){this(order,kind,name,latitude,longitude,latitude+","+longitude);} }
    record NavigationIntent(List<Stop> stops, String sourceStatus) {}
    enum Outcome { UNSUPPORTED, REQUEST_ACCEPTED, VEHICLE_ACKNOWLEDGED, APPLIED_CONFIRMED, FAILED, UNKNOWN }
    NavigationIntent prepare(Routing.Route route);
    Outcome send(NavigationIntent intent);
}
