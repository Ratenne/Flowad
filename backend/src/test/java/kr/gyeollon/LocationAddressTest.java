package kr.gyeollon;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Path;
import java.sql.DriverManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.locationtech.jts.io.WKBWriter;
import org.locationtech.jts.io.WKTReader;

class LocationAddressTest {
    @TempDir Path directory;

    @Test
    void findsBuildingThenRoadAddressAndLabelsNearbyMatches() throws Exception {
        Path index = directory.resolve("addresses.sqlite");
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + index);
             var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT, address TEXT, shape BLOB)");
            statement.execute("CREATE VIRTUAL TABLE bounds USING rtree(id, west, east, south, north)");
            var geometry = new WKTReader();
            var wkb = new WKBWriter();
            try (var insert = connection.prepareStatement("INSERT INTO place VALUES (?, ?, ?, ?)")) {
                insert.setInt(1, 1);
                insert.setString(2, "테스트 건물");
                insert.setString(3, "테스트로 1");
                insert.setBytes(4, wkb.write(geometry.read(
                    "POLYGON ((129 35, 129.0001 35, 129.0001 35.0001, 129 35.0001, 129 35))")));
                insert.executeUpdate();
                insert.setInt(1, 2);
                insert.setString(2, "");
                insert.setString(3, "테스트로 2");
                insert.setBytes(4, wkb.write(geometry.read("POINT (129.001 35)")));
                insert.executeUpdate();
            }
            statement.execute("INSERT INTO bounds VALUES (1, 129, 129.0001, 35, 35.0001)");
            statement.execute("INSERT INTO bounds VALUES (2, 129.001, 129.001, 35, 35)");
        }
        var service = new LocationAddress(index.toString());
        var building = service.address(new LocationAddress.Coordinates(35.00005, 129.00005));
        assertEquals(new LocationAddress.Match("테스트 건물", "BUILDING"), building.getBody());
        assertEquals("no-store", building.getHeaders().getCacheControl());
        assertEquals(new LocationAddress.Match("테스트로 2", "ROAD_ADDRESS"),
            service.address(new LocationAddress.Coordinates(35d, 129.001)).getBody());
        assertEquals(new LocationAddress.Match("테스트로 1", "NEARBY_ADDRESS"),
            service.address(new LocationAddress.Coordinates(35.00005, 129.0002)).getBody());
        assertEquals(204, service.address(new LocationAddress.Coordinates(35.01, 129d)).getStatusCode().value());
        assertEquals(400, service.address(new LocationAddress.Coordinates(91d, 129d)).getStatusCode().value());
        assertEquals(503, new LocationAddress("").address(new LocationAddress.Coordinates(35d, 129d))
            .getStatusCode().value());
    }
}
