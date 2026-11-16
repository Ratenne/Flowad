package kr.gyeollon;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

/** Explicitly configured driving service; no fallback to estimates on provider failure. */
public class OsrmRoadProvider implements Routing.RoadProvider {
 private final ObjectMapper mapper;
 private final String base;
 private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).followRedirects(HttpClient.Redirect.NEVER).build();
 public OsrmRoadProvider(ObjectMapper mapper,String base){
  URI uri=URI.create(base);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getRawQuery()!=null||uri.getUserInfo()!=null)throw new IllegalArgumentException("ROAD_ROUTING_URL must be HTTPS");
  this.mapper=mapper;this.base=base.replaceAll("/+$","");
 }
 public Routing.ProviderResult route(List<Routing.Point> points)throws Routing.RoutingFailure{
  String coordinates=points.stream().map(p->p.longitude()+","+p.latitude()).collect(Collectors.joining(";"));
  try{
   var response=client.send(HttpRequest.newBuilder(URI.create(base+"/route/v1/driving/"+coordinates+"?steps=true&geometries=geojson&overview=false&radiuses="+points.stream().map(p->"100").collect(Collectors.joining(";")))).timeout(Duration.ofSeconds(90)).GET().build(),HttpResponse.BodyHandlers.ofString());
   if(response.statusCode()==429)throw new Routing.RoutingFailure("RATE_LIMIT");
   if(response.statusCode()==403)throw new Routing.RoutingFailure("PROVIDER_PERMISSION_DENIED");
   JsonNode data=mapper.readTree(response.body());
   checkStatus(response.statusCode(),data);
   return parse(data,points);
  }catch(Routing.RoutingFailure e){throw e;}catch(InterruptedException e){Thread.currentThread().interrupt();throw new Routing.RoutingFailure("PROVIDER_UNAVAILABLE");}catch(Exception e){throw new Routing.RoutingFailure("PROVIDER_UNAVAILABLE");}
 }
 static void checkStatus(int status,JsonNode root)throws Routing.RoutingFailure{
  if(status==400){String code=root.path("code").asText();throw new Routing.RoutingFailure("NoSegment".equals(code)?"WAYPOINT_TOO_FAR_FROM_ROAD":"NoRoute".equals(code)?"NO_ROAD_ROUTE":"INVALID_PROVIDER_RESPONSE");}
  if(status!=200)throw new Routing.RoutingFailure("PROVIDER_UNAVAILABLE");
 }
 static Routing.ProviderResult parse(JsonNode root,List<Routing.Point> points)throws Routing.RoutingFailure{
  if(!"Ok".equals(root.path("code").asText()))throw new Routing.RoutingFailure("NO_ROAD_ROUTE");
  JsonNode waypoints=root.path("waypoints"),legs=root.path("routes").path(0).path("legs");
  if(!waypoints.isArray()||waypoints.size()!=points.size()||!legs.isArray()||legs.size()!=points.size()-1)throw new Routing.RoutingFailure("INCOMPLETE_ROUTE");
  for(int i=0;i<points.size();i++){
   JsonNode w=waypoints.get(i),xy=w.path("location");double d=number(w.path("distance"));
   if(d<0||d>100||!xy.isArray()||xy.size()!=2)throw new Routing.RoutingFailure("WAYPOINT_TOO_FAR_FROM_ROAD");
   double lon=number(xy.get(0)),lat=number(xy.get(1));Routing.validCoordinate(lat,lon);
   if(Application.distance(lat,lon,points.get(i).latitude(),points.get(i).longitude())>.101)throw new Routing.RoutingFailure("WAYPOINT_TOO_FAR_FROM_ROAD");
  }
  List<Routing.Leg> result=new ArrayList<>();
  for(int i=0;i<legs.size();i++){
   JsonNode leg=legs.get(i);double meters=number(leg.path("distance")),seconds=number(leg.path("duration"));
   if(seconds>Integer.MAX_VALUE||meters<=0||seconds<=0)throw new Routing.RoutingFailure("INVALID_PROVIDER_RESPONSE");
   List<Routing.Coordinate> geometry=new ArrayList<>();
   for(JsonNode step:leg.path("steps"))for(JsonNode xy:step.path("geometry").path("coordinates")){
    if(!xy.isArray()||xy.size()!=2)throw new Routing.RoutingFailure("INVALID_PROVIDER_RESPONSE");
    double lon=number(xy.get(0)),lat=number(xy.get(1));Routing.validCoordinate(lat,lon);geometry.add(new Routing.Coordinate(lat,lon));
   }
   if(geometry.size()<2)throw new Routing.RoutingFailure("INCOMPLETE_ROUTE");
   var first=geometry.get(0);var last=geometry.get(geometry.size()-1);
   if(Application.distance(first.latitude(),first.longitude(),points.get(i).latitude(),points.get(i).longitude())>.15||Application.distance(last.latitude(),last.longitude(),points.get(i+1).latitude(),points.get(i+1).longitude())>.15)throw new Routing.RoutingFailure("INCOMPLETE_ROUTE");
   result.add(new Routing.Leg(i,i+1,meters/1000,(int)Math.ceil(seconds),List.copyOf(geometry)));
  }
  return new Routing.ProviderResult(List.copyOf(result),"ROAD_ROUTED","OSRM / OpenStreetMap","PROVIDER_GEOMETRY");
 }
 private static double number(JsonNode n)throws Routing.RoutingFailure{if(n==null||!n.isNumber()||!Double.isFinite(n.asDouble()))throw new Routing.RoutingFailure("INVALID_PROVIDER_RESPONSE");return n.asDouble();}
}
