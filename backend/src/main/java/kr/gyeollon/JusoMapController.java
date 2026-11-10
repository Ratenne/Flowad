package kr.gyeollon;

import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.util.UriComponentsBuilder;

@RestController
class JusoMapController {
    private static final String SCRIPT = "https://business.juso.go.kr/juso_support_center/js/addrlink/map/jusoro_map_api.min.js";
    private static final CoordinateTransform TO_KOREA_UNIFIED_GRID = koreaUnifiedGrid();
    private final String key;

    JusoMapController(@Value("${JUSO_MAP_API_KEY:}") String key) {
        this.key = key.strip();
    }

    @PostMapping(value = "/api/location/juso-map", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE,
        produces = "text/html;charset=UTF-8")
    ResponseEntity<String> map(@RequestParam double latitude, @RequestParam double longitude) {
        if (!(latitude >= 32 && latitude <= 40 && longitude >= 124 && longitude <= 132)) {
            return page(400, "<p>국내 위치의 좌표를 확인해 주세요.</p>");
        }
        if (!key.matches("[A-Za-z0-9._+/=-]+")) {
            return page(503, "<p>공식 주소 지도를 사용할 수 없어요.</p>");
        }

        var point = TO_KOREA_UNIFIED_GRID.transform(new ProjCoordinate(longitude, latitude), new ProjCoordinate());
        String scriptUrl = UriComponentsBuilder.fromUriString(SCRIPT)
            .queryParam("confmKey", "{key}")
            .queryParam("searchType", 1)
            .queryParam("pointX", point.x)
            .queryParam("pointY", point.y)
            .queryParam("skinType", 2)
            .encode().buildAndExpand(key).toUriString();
        return page(200, """
            <div id="mapWrap" class="mapWrap" style="width:100%%;height:100%%"></div>
            <script src="%s"></script>
            """.formatted(HtmlUtils.htmlEscape(scriptUrl)));
    }

    private static ResponseEntity<String> page(int status, String body) {
        return ResponseEntity.status(status)
            .cacheControl(CacheControl.noStore())
            .header("Content-Security-Policy", "sandbox allow-scripts; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
            .header("Referrer-Policy", "strict-origin")
            .body("""
                <!doctype html>
                <html lang="ko" style="height:100%%">
                <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                <title>공식 주소 지도</title></head>
                <body style="height:100%%;margin:0">%s</body></html>
                """.formatted(body));
    }

    private static CoordinateTransform koreaUnifiedGrid() {
        var factory = new CRSFactory();
        var wgs84 = factory.createFromParameters("WGS84", "+proj=longlat +datum=WGS84 +no_defs");
        var epsg5179 = factory.createFromParameters("EPSG:5179",
            "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs");
        return new CoordinateTransformFactory().createTransform(wgs84, epsg5179);
    }
}
