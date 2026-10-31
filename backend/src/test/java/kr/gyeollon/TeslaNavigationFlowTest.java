package kr.gyeollon;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class TeslaNavigationFlowTest {
 @Test void previewRejectsEstimatesAndBindsVehicleWithSingleUse()throws Exception{
  var integration=mock(TeslaIntegration.class);var routing=mock(Routing.class);var request=new MockHttpServletRequest();request.setSecure(true);
  var controller=new TeslaStatusController(integration,routing);var status=controller.status(request).getBody();request.addHeader("X-CSRF-Token",status.get("csrf"));
  when(integration.selected(any())).thenReturn("selected-car");
  var estimated=new Routing(new ObjectMapper(),new Routing.MockProvider()).create("paju",37.5,127,37.5,127,0);
  when(routing.create(anyString(),anyDouble(),anyDouble(),anyDouble(),anyDouble(),anyInt())).thenReturn(estimated);
  var input=new TeslaStatusController.PreviewRequest("paju",37.5,127);
  assertEquals("ROAD_ROUTE_REQUIRED",assertThrows(TeslaIntegration.Failure.class,()->controller.preview(request,input)).code);
  var road=new Routing.Route(estimated.points(),estimated.legs(),estimated.distanceKm(),estimated.drivingSeconds(),0,estimated.totalSeconds(),"ROAD_ROUTED","test",estimated.generatedAt(),"PROVIDER_GEOMETRY","HIGHLIGHT_ONLY",List.of());
  when(routing.create(anyString(),anyDouble(),anyDouble(),anyDouble(),anyDouble(),anyInt())).thenReturn(road);
  var preview=(Map<?,?>)controller.preview(request,input).getBody();String id=(String)preview.get("planId");
  when(integration.sendDestination(any(),any())).thenReturn("REQUEST_ACCEPTED");
  var send=new TeslaStatusController.SendRequest(id,1);controller.send(request,send);
  assertThrows(TeslaIntegration.Failure.class,()->controller.send(request,send));
  var confirmed=(Map<?,?>)controller.confirm(request,new TeslaStatusController.ConfirmRequest(id,1,true)).getBody();assertEquals("USER_CONFIRMED",confirmed.get("status"));assertEquals(false,confirmed.get("automaticallyVerified"));
  verify(integration,times(1)).sendDestination(any(),any());
  when(integration.selected(any())).thenReturn("other-car");assertEquals("PLAN_EXPIRED",assertThrows(TeslaIntegration.Failure.class,()->controller.send(request,send)).code);
 }
 @Test void csrfAndHttpsRejectBeforeSending()throws Exception{
  var integration=mock(TeslaIntegration.class);var controller=new TeslaStatusController(integration,mock(Routing.class));var req=new MockHttpServletRequest();
  assertEquals("HTTPS_REQUIRED",assertThrows(TeslaIntegration.Failure.class,()->controller.send(req,new TeslaStatusController.SendRequest("x",1))).code);
  req.setSecure(true);assertEquals("INVALID_CSRF",assertThrows(TeslaIntegration.Failure.class,()->controller.send(req,new TeslaStatusController.SendRequest("x",1))).code);verifyNoInteractions(integration);
 }
 @Test void commandRequiresGrantedScopeAndOnlineVehicle()throws Exception{
  var gateway=mock(TeslaIntegration.Gateway.class);var mapper=new ObjectMapper();
  when(gateway.token(any())).thenReturn(mapper.readTree("{\"access_token\":\"test\",\"refresh_token\":\"test\",\"expires_in\":3600,\"scope\":\"vehicle_cmds\"}"));
  var integration=new TeslaIntegration("id","secret","https://example.test/callback",gateway,java.time.Clock.systemUTC());var s=new TeslaIntegration.Session();
  String url=integration.begin(s,false,true);String state=java.net.URLDecoder.decode(url.substring(url.indexOf("&state=")+7).split("&")[0],java.nio.charset.StandardCharsets.UTF_8);integration.callback(s,state,"code",null);
  when(gateway.get(eq("/api/1/users/region"),anyString())).thenReturn(mapper.readTree("{\"response\":{\"fleet_api_base_url\":\""+TeslaIntegration.AUDIENCE+"\"}}"));
  when(gateway.get(eq("/api/1/vehicles"),anyString())).thenReturn(mapper.readTree("{\"response\":[{\"vin\":\"TEST\"}]}"));integration.select(s,integration.vehicles(s).get(0).id());
  when(gateway.get(eq("/api/1/vehicles/TEST"),anyString())).thenReturn(mapper.readTree("{\"response\":{\"state\":\"asleep\"}}"));var stop=new VehicleNavigationAdapter.Stop(1,"RETURN","home",37.5,127);
  assertEquals("OFFLINE_OR_ASLEEP",assertThrows(TeslaIntegration.Failure.class,()->integration.sendDestination(s,stop)).code);verify(gateway,never()).command(anyString(),anyString(),any());
  when(gateway.get(eq("/api/1/vehicles/TEST"),anyString())).thenReturn(mapper.readTree("{\"response\":{\"state\":\"online\"}}"));when(gateway.command(anyString(),anyString(),any())).thenReturn(mapper.readTree("{\"response\":{\"result\":true}}"));assertEquals("REQUEST_ACCEPTED",integration.sendDestination(s,stop));
  verify(gateway).command(eq("/api/1/vehicles/TEST/command/navigation_request"),eq("test"),argThat(body->body.get("value").equals(Map.of("android.intent.extra.TEXT","37.5,127.0"))));
  assertEquals("COMMAND_PERMISSION_REQUIRED",assertThrows(TeslaIntegration.Failure.class,()->integration.sendDestination(new TeslaIntegration.Session(),stop)).code);
 }
 @Test void destinationPreviewKeepsAddressAndVehicleBinding()throws Exception{
  var integration=mock(TeslaIntegration.class);var routing=mock(Routing.class);var req=new MockHttpServletRequest();req.setSecure(true);
  var controller=new TeslaStatusController(integration,routing);req.addHeader("X-CSRF-Token",controller.status(req).getBody().get("csrf"));
  when(integration.selected(any())).thenReturn("model-y-session-id");
  var road=mock(Routing.Route.class);when(routing.destination(anyString(),anyDouble(),anyDouble(),anyDouble(),anyDouble())).thenReturn(road);
  var input=new TeslaStatusController.DestinationRequest("롯데월드 어드벤처 부산","부산광역시 기장군 기장읍 동부산관광로 42",35.19602,129.2132,35.1796,129.0756);
  var result=(Map<?,?>)controller.destination(req,input).getBody();
  var stops=(java.util.List<VehicleNavigationAdapter.Stop>)result.get("stops");assertEquals(1,stops.size());assertTrue(stops.get(0).navigationText().contains("동부산관광로 42"));
  when(integration.sendDestination(any(),any())).thenReturn("REQUEST_ACCEPTED");controller.send(req,new TeslaStatusController.SendRequest((String)result.get("planId"),1));
  verify(integration).sendDestination(any(),argThat(stop->stop.navigationText().contains("롯데월드")));
 }
 @Test void oauthRequiresRequestedScopesEvenWhenTokenOmitsScope()throws Exception{
  var gateway=mock(TeslaIntegration.Gateway.class);var mapper=new ObjectMapper();
  when(gateway.token(any())).thenReturn(mapper.readTree("{\"access_token\":\"test\",\"refresh_token\":\"test\",\"expires_in\":3600}"));
  var integration=new TeslaIntegration("id","secret","https://example.test/callback",gateway,java.time.Clock.systemUTC());var session=new TeslaIntegration.Session();
  String url=integration.begin(session,false,true);assertTrue(url.contains("require_requested_scopes=true"));assertTrue(url.contains("vehicle_cmds"));
  String state=java.net.URLDecoder.decode(url.substring(url.indexOf("&state=")+7).split("&")[0],java.nio.charset.StandardCharsets.UTF_8);integration.callback(session,state,"code",null);
  assertEquals("NO_VEHICLE_SELECTED",assertThrows(TeslaIntegration.Failure.class,()->integration.sendDestination(session,new VehicleNavigationAdapter.Stop(1,"DESTINATION","test",0,0))).code);
 }
}
