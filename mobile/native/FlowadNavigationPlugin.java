package com.ravirgo.flowad;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Stage 3 preparation only: verifies a signed ticket server-side, returns ordered stops.
 * Does NOT invoke Pleos or send Tesla/vehicle commands. Never logs tickets/coordinates.
 */
@CapacitorPlugin(name = "FlowadNavigation")
public class FlowadNavigationPlugin extends Plugin {
  private static final String RESOLVE_URL = "https://ravirgo.com/flowad/api/navigation/resolve";

  @PluginMethod
  public void prepareVerifiedRoute(PluginCall call) {
    String ticket = call.getString("ticket");
    if (ticket == null || ticket.isEmpty() || ticket.length() > 65536) {
      call.reject("INVALID_TICKET");
      return;
    }
    new Thread(() -> {
      HttpURLConnection connection = null;
      try {
        connection = (HttpURLConnection) new URL(RESOLVE_URL).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(12000);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setDoOutput(true);
        byte[] request = new JSONObject().put("ticket", ticket).toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream stream = connection.getOutputStream()) { stream.write(request); }
        if (connection.getResponseCode() != 200) {
          call.reject("TICKET_REJECTED");
          return;
        }
        JSONObject data;
        try (InputStream stream = connection.getInputStream()) {
          data = new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        }
        JSONObject route = data.getJSONObject("route");
        JSONArray stops = route.getJSONArray("points");
        if (!"ROAD_ROUTED".equals(route.optString("status")) || stops.length() < 2 || stops.length() > 17) {
          call.reject("ROAD_VERIFICATION_REQUIRED");
          return;
        }
        for (int i = 0; i < stops.length(); i++) {
          JSONObject point = stops.getJSONObject(i);
          if (point.getInt("order") != i ||
              !Double.isFinite(point.getDouble("latitude")) ||
              !Double.isFinite(point.getDouble("longitude")) ||
              Math.abs(point.getDouble("latitude")) > 90 ||
              Math.abs(point.getDouble("longitude")) > 180) {
            call.reject("INVALID_ROUTE_POINTS");
            return;
          }
        }
        JSObject result = new JSObject();
        result.put("status", "READY_FOR_PLEOS_STAGE4");
        result.put("courseId", data.getString("courseId"));
        result.put("points", stops);
        call.resolve(result);
      } catch (Exception ex) {
        call.reject("ROUTE_VERIFICATION_FAILED");
      } finally {
        if (connection != null) connection.disconnect();
      }
    }).start();
  }
}
