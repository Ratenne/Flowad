package kr.gyeollon;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.xml.sax.InputSource;
import org.xml.sax.helpers.DefaultHandler;
import java.io.StringReader;
import com.fasterxml.jackson.core.json.JsonReadFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;

final class JusoAddressClient {
    static final String URL = "https://business.juso.go.kr/addrlink/addrMapData.do";
    interface Gateway { String request(String form) throws Exception; }
    static final class Failure extends Exception {
        final String code;
        Failure(String code) { super(code); this.code = code; }
    }
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();

    static String request(String form) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(URL)).timeout(Duration.ofSeconds(3))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form)).build();
        var pending = HTTP.sendAsync(request, ignored -> boundedBody());
        try {
            var response = pending.get(3, TimeUnit.SECONDS);
            if (response.statusCode() != 200) throw new Failure("JUSO_UNAVAILABLE");
            return response.body();
        } catch (java.util.concurrent.TimeoutException e) {
            pending.cancel(true);
            throw new Failure("JUSO_TIMEOUT");
        } catch (java.util.concurrent.ExecutionException e) {
            if (e.getCause() instanceof Failure failure) throw failure;
            throw new Failure("JUSO_UNAVAILABLE");
        }
    }

    private static HttpResponse.BodySubscriber<String> boundedBody() {
        var delegate = HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8);
        return new HttpResponse.BodySubscriber<>() {
            private java.util.concurrent.Flow.Subscription subscription;
            private int received;
            public java.util.concurrent.CompletionStage<String> getBody() { return delegate.getBody(); }
            public void onSubscribe(java.util.concurrent.Flow.Subscription value) { subscription = value; delegate.onSubscribe(value); }
            public void onNext(java.util.List<java.nio.ByteBuffer> chunks) {
                for (var chunk : chunks) received += chunk.remaining();
                if (received > 262144) { subscription.cancel(); delegate.onError(new Failure("JUSO_INVALID_RESPONSE")); }
                else delegate.onNext(chunks);
            }
            public void onError(Throwable error) { delegate.onError(error); }
            public void onComplete() { delegate.onComplete(); }
        };
    }

    static String form(String key, double latitude, double longitude) {
        var point = JusoMapController.project(latitude, longitude);
        return "confmKey=" + URLEncoder.encode(key, StandardCharsets.UTF_8)
            + "&searchType=1&pointX=" + point.x + "&pointY=" + point.y
            + "&encryptYn=Y&encodingType=UTF-8&resultType=2&currentPage=1&countPerPage=5&callback=flowadJuso";
    }

    static LocationAddress.Match parse(String raw) throws Exception {
        if (raw == null || raw.getBytes(StandardCharsets.UTF_8).length > 262144) throw new Failure("JUSO_INVALID_RESPONSE");
        String wrapper = raw.strip();
        if (wrapper.endsWith(";")) wrapper = wrapper.substring(0, wrapper.length() - 1).stripTrailing();
        if (!wrapper.startsWith("flowadJuso(") || !wrapper.endsWith(")")) throw new Failure("JUSO_INVALID_RESPONSE");
        // Official JSONP has single-quoted fields. Parse as data, never execute.
        var mapper = JsonMapper.builder().enable(JsonReadFeature.ALLOW_SINGLE_QUOTES)
            .enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
        var json = mapper.readTree(wrapper.substring(11, wrapper.length() - 1));
        if (!json.path("returnXml").isTextual()) throw new Failure("JUSO_INVALID_RESPONSE");
        var factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        var builder = factory.newDocumentBuilder();
        builder.setErrorHandler(new DefaultHandler());
        var root = builder.parse(new InputSource(new StringReader(json.path("returnXml").asText()))).getDocumentElement();
        if (!root.getTagName().equals("results")) throw new Failure("JUSO_INVALID_RESPONSE");
        String code = text(root, "errorCode");
        if (code.isEmpty()) throw new Failure("JUSO_INVALID_RESPONSE");
        if (!code.equals("0")) throw new Failure(code.equals("E0001") ? "JUSO_KEY_REJECTED" : "JUSO_REQUEST_REJECTED");
        String count = text(root, "totalCount");
        if (!count.matches("[0-9]+")) throw new Failure("JUSO_INVALID_RESPONSE");
        if (count.matches("0+")) return null;
        var first = root.getElementsByTagName("juso").item(0);
        if (!(first instanceof org.w3c.dom.Element item)) throw new Failure("JUSO_INVALID_RESPONSE");
        String label = text(item, "roadAddrPart1");
        if (label.isEmpty()) label = text(item, "roadAddr");
        if (label.isEmpty() || label.length() > 500) throw new Failure("JUSO_INVALID_RESPONSE");
        return new LocationAddress.Match(label, "ROAD_ADDRESS", "JUSO_MAP");
    }

    private static String text(org.w3c.dom.Element element, String tag) {
        var node = element.getElementsByTagName(tag).item(0);
        return node == null ? "" : node.getTextContent().strip();
    }
}
