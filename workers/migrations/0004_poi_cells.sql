-- Dense public snapshots preserve every POI while reducing free-tier write amplification.
-- The normalized tables remain useful for staging/tests and small incremental feeds.
CREATE TABLE poi_storage(dataset_id TEXT PRIMARY KEY REFERENCES poi_datasets(id),format TEXT NOT NULL,record_count INTEGER NOT NULL);
CREATE TABLE poi_cells(dataset_id TEXT NOT NULL REFERENCES poi_datasets(id),cell_id TEXT NOT NULL,
 min_lat REAL NOT NULL,max_lat REAL NOT NULL,min_lon REAL NOT NULL,max_lon REAL NOT NULL,
 records_json TEXT NOT NULL CHECK(json_valid(records_json)),PRIMARY KEY(dataset_id,cell_id));
CREATE VIRTUAL TABLE poi_cell_spatial USING rtree(id,min_lat,max_lat,min_lon,max_lon);
CREATE TRIGGER poi_cell_insert AFTER INSERT ON poi_cells BEGIN INSERT INTO poi_cell_spatial VALUES(new.rowid,new.min_lat,new.max_lat,new.min_lon,new.max_lon); END;
CREATE TRIGGER poi_cell_delete AFTER DELETE ON poi_cells BEGIN DELETE FROM poi_cell_spatial WHERE id=old.rowid; END;
CREATE VIEW poi_catalog AS
 SELECT p.dataset_id,p.id,p.provider,p.source_id,p.name,p.latitude,p.longitude,p.category,p.scenery,p.region,p.quality,p.access_status,p.duplicate_of,p.deleted_at FROM pois p
 WHERE NOT EXISTS(SELECT 1 FROM poi_storage s WHERE s.dataset_id=p.dataset_id AND s.format='CELLS')
 UNION ALL
 SELECT c.dataset_id,json_extract(j.value,'$.id'),json_extract(j.value,'$.provider'),json_extract(j.value,'$.source_id'),json_extract(j.value,'$.name'),json_extract(j.value,'$.latitude'),json_extract(j.value,'$.longitude'),json_extract(j.value,'$.category'),json_extract(j.value,'$.scenery'),json_extract(j.value,'$.region'),json_extract(j.value,'$.quality'),json_extract(j.value,'$.access_status'),json_extract(j.value,'$.duplicate_of'),json_extract(j.value,'$.deleted_at') FROM poi_cells c,json_each(c.records_json) j;
CREATE VIEW poi_source_catalog AS
 SELECT dataset_id,poi_id,provider,source_id,attributes_json,source_updated_at,attribution FROM poi_sources
 UNION ALL SELECT c.dataset_id,json_extract(j.value,'$.id'),json_extract(j.value,'$.provider'),json_extract(j.value,'$.source_id'),json_extract(j.value,'$.attributes_json'),json_extract(j.value,'$.source_updated_at'),json_extract(j.value,'$.attribution') FROM poi_cells c,json_each(c.records_json) j;
CREATE VIEW poi_access_catalog AS
 SELECT dataset_id,poi_id,kind,latitude,longitude,status,source,verified_at FROM poi_access_points
 UNION ALL SELECT c.dataset_id,json_extract(j.value,'$.id'),json_extract(a.value,'$.kind'),json_extract(a.value,'$.latitude'),json_extract(a.value,'$.longitude'),json_extract(a.value,'$.status'),json_extract(a.value,'$.source'),json_extract(a.value,'$.verified_at') FROM poi_cells c,json_each(c.records_json) j,json_each(json_extract(j.value,'$.access_points')) a;
