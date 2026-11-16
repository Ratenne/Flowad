-- Shared free-tier OSRM concurrency budget. No user coordinates or identifiers.
CREATE TABLE poi_routing_slots(id INTEGER PRIMARY KEY,lease TEXT,expires INTEGER NOT NULL DEFAULT 0);
INSERT INTO poi_routing_slots(id) VALUES(1),(2);
