-- Public POI mappings only. No user origins, OAuth data or API keys.
CREATE TABLE google_place_mappings (
 poi_id TEXT PRIMARY KEY, point_hash TEXT NOT NULL, place_id TEXT,
 reference_json TEXT CHECK(reference_json IS NULL OR json_valid(reference_json)),
 reference_expires INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
 reason TEXT, retry_after INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX google_place_reference_expiry ON google_place_mappings(reference_expires);
CREATE TABLE google_places_usage (
 period TEXT NOT NULL, sku TEXT NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(period,sku)
);
CREATE TABLE google_places_slots(id INTEGER PRIMARY KEY,lease TEXT,expires INTEGER NOT NULL DEFAULT 0);
INSERT INTO google_places_slots(id) VALUES(1),(2);
