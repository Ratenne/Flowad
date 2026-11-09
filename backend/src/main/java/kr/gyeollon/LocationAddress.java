package kr.gyeollon;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.io.ParseException;
import org.locationtech.jts.io.WKBReader;
import org.locationtech.jts.operation.distance.DistanceOp;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.sqlite.SQLiteConfig;

@RestController
class LocationAddress {
    private static final double NEARBY_METRES = 25;
    private static final double METRES_PER_DEGREE = 111_320;
    private static final GeometryFactory GEOMETRIES = new GeometryFactory();
    private static final String SEARCH = """
        SELECT p.name, p.address, p.shape FROM bounds b
        CROSS JOIN place p ON p.id = b.id
        WHERE b.west <= ? AND b.east >= ? AND b.south <= ? AND b.north >= ?
        """;
    private final Path index;

    LocationAddress(@Value("${ADDRESS_INDEX_PATH:}") String file) {
        index = file.isBlank() ? null : Path.of(file).toAbsolutePath();
    }

    record Coordinates(Double latitude, Double longitude) {}
    record Match(String label, String type) {}
    private record Candidate(Match match, int priority, double distance, double area) {
        boolean precedes(Candidate other) {
            if (priority != other.priority) return priority < other.priority;
            if (distance != other.distance) return distance < other.distance;
            return area < other.area;
        }
    }

    @PostMapping("/api/location/address")
    ResponseEntity<Match> address(@RequestBody Coordinates coordinates) {
        var noStore = CacheControl.noStore();
        if (!valid(coordinates.latitude(), 90) || !valid(coordinates.longitude(), 180)) {
            return ResponseEntity.badRequest().cacheControl(noStore).build();
        }
        if (index == null || !Files.isRegularFile(index)) {
            return ResponseEntity.status(503).cacheControl(noStore).build();
        }
        try {
            Match match = find(coordinates.latitude(), coordinates.longitude());
            return match == null ? ResponseEntity.noContent().cacheControl(noStore).build()
                : ResponseEntity.ok().cacheControl(noStore).body(match);
        } catch (SQLException | ParseException e) {
            return ResponseEntity.status(503).cacheControl(noStore).build();
        }
    }

    private Match find(double latitude, double longitude) throws SQLException, ParseException {
        var config = new SQLiteConfig();
        config.setReadOnly(true);
        var point = GEOMETRIES.createPoint(new Coordinate(longitude, latitude));
        var reader = new WKBReader(GEOMETRIES);
        double longitudeScale = METRES_PER_DEGREE * Math.max(0.01, Math.cos(Math.toRadians(latitude)));
        double dx = (NEARBY_METRES + 1) / longitudeScale;
        double dy = (NEARBY_METRES + 1) / METRES_PER_DEGREE;
        Candidate best = null;
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + index, config.toProperties());
             var query = connection.prepareStatement(SEARCH)) {
            query.setDouble(1, longitude + dx);
            query.setDouble(2, longitude - dx);
            query.setDouble(3, latitude + dy);
            query.setDouble(4, latitude - dy);
            try (var rows = query.executeQuery()) {
                while (rows.next()) {
                    var shape = reader.read(rows.getBytes("shape"));
                    String name = rows.getString("name");
                    String address = rows.getString("address");
                    Candidate candidate;
                    if (shape.covers(point)) {
                        if (name.isEmpty() && address.isEmpty()) continue;
                        candidate = name.isEmpty()
                            ? new Candidate(new Match(address, "ROAD_ADDRESS"), 1, 0, shape.getArea())
                            : new Candidate(new Match(name, "BUILDING"), 0, 0, shape.getArea());
                    } else {
                        if (address.isEmpty()) continue;
                        Coordinate nearest = DistanceOp.nearestPoints(shape, point)[0];
                        double distance = Math.hypot((nearest.x - longitude) * longitudeScale,
                            (nearest.y - latitude) * METRES_PER_DEGREE);
                        if (distance > NEARBY_METRES) continue;
                        candidate = new Candidate(new Match(address, "NEARBY_ADDRESS"), 2, distance, shape.getArea());
                    }
                    if (best == null || candidate.precedes(best)) best = candidate;
                }
            }
        }
        return best == null ? null : best.match();
    }

    private static boolean valid(Double value, double limit) {
        return value != null && Double.isFinite(value) && Math.abs(value) <= limit;
    }
}
