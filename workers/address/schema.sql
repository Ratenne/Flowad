-- Optional public address index. Separate from encrypted session DB.
-- Use regular indexed bounds: the Java index's RTree virtual table is not required.
CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, shape BLOB NOT NULL);
CREATE TABLE bounds (id INTEGER PRIMARY KEY, west REAL NOT NULL, east REAL NOT NULL, south REAL NOT NULL, north REAL NOT NULL);
CREATE INDEX bounds_west ON bounds(west);
CREATE INDEX bounds_south ON bounds(south);
