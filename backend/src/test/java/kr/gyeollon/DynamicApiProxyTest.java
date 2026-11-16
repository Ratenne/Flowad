package kr.gyeollon;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import static org.junit.jupiter.api.Assertions.*;
class DynamicApiProxyTest {
 @Test void delegatesOnlyToExplicitEngineAndKeepsFields()throws Exception {
  var mapper=new ObjectMapper();var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/api/recommendations",exchange->{byte[] body=exchange.getRequestBody().readAllBytes();exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();});server.start();
  try{var client=new DynamicApiProxy("http://127.0.0.1:"+server.getAddress().getPort(),mapper);var result=client.post("/api/recommendations",mapper.readTree("{\"requestId\":\"isolated-test\",\"roundTrip\":false}"));assertEquals(200,result.getStatusCode().value());assertEquals("isolated-test",((com.fasterxml.jackson.databind.JsonNode)result.getBody()).path("requestId").asText());}
  finally{server.stop(0);}
  assertEquals(503,new DynamicApiProxy("",mapper).post("/api/recommendations",mapper.createObjectNode()).getStatusCode().value());
  assertThrows(IllegalArgumentException.class,()->new DynamicApiProxy("http://example.com",mapper));
 }
}
