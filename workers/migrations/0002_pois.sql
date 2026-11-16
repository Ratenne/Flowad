-- Public POI snapshots only. Does not alter authentication/session tables.
CREATE TABLE poi_datasets (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, created_at TEXT NOT NULL,
 source_updated_at TEXT NOT NULL, attribution TEXT NOT NULL, status TEXT NOT NULL
);
CREATE TABLE poi_provider_state (provider TEXT PRIMARY KEY, active_dataset TEXT NOT NULL REFERENCES poi_datasets(id));
CREATE TABLE pois (
 dataset_id TEXT NOT NULL REFERENCES poi_datasets(id), id TEXT NOT NULL,
 provider TEXT NOT NULL, source_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
 latitude REAL NOT NULL CHECK(latitude BETWEEN 32 AND 39.5), longitude REAL NOT NULL CHECK(longitude BETWEEN 124 AND 132),
 category TEXT NOT NULL, scenery TEXT NOT NULL, address TEXT, region TEXT,
 description TEXT, quality TEXT NOT NULL, access_status TEXT NOT NULL,
 duplicate_of TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 PRIMARY KEY(dataset_id,id)
);
CREATE INDEX poi_bbox ON pois(latitude,longitude);
CREATE INDEX poi_dataset ON pois(dataset_id,deleted_at);
CREATE INDEX poi_name ON pois(normalized_name,latitude,longitude);
CREATE VIRTUAL TABLE poi_spatial USING rtree(id,min_lat,max_lat,min_lon,max_lon);
CREATE TRIGGER poi_spatial_insert AFTER INSERT ON pois BEGIN
 INSERT INTO poi_spatial VALUES(new.rowid,new.latitude,new.latitude,new.longitude,new.longitude);
END;
CREATE TRIGGER poi_spatial_delete AFTER DELETE ON pois BEGIN DELETE FROM poi_spatial WHERE id=old.rowid; END;
CREATE TRIGGER poi_spatial_update AFTER UPDATE OF latitude,longitude ON pois BEGIN
 UPDATE poi_spatial SET min_lat=new.latitude,max_lat=new.latitude,min_lon=new.longitude,max_lon=new.longitude WHERE id=new.rowid;
END;
CREATE TABLE poi_sources (
 dataset_id TEXT NOT NULL, poi_id TEXT NOT NULL, provider TEXT NOT NULL, source_id TEXT NOT NULL,
 attributes_json TEXT NOT NULL, source_updated_at TEXT NOT NULL, attribution TEXT NOT NULL,
 PRIMARY KEY(dataset_id,poi_id,provider,source_id), FOREIGN KEY(dataset_id,poi_id) REFERENCES pois(dataset_id,id) ON DELETE CASCADE
);
CREATE TABLE poi_access_points (
 dataset_id TEXT NOT NULL, poi_id TEXT NOT NULL, kind TEXT NOT NULL,
 latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL,
 source TEXT NOT NULL, verified_at TEXT,
 PRIMARY KEY(dataset_id,poi_id,kind), FOREIGN KEY(dataset_id,poi_id) REFERENCES pois(dataset_id,id) ON DELETE CASCADE
);
CREATE TABLE poi_sync_jobs (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
 status TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0, inserted INTEGER NOT NULL DEFAULT 0,
 updated INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
 checkpoint TEXT, error TEXT
);
