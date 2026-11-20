CREATE TABLE road_provider_cooldown (
  origin TEXT PRIMARY KEY,
  retry_until INTEGER NOT NULL,
  probe_until INTEGER NOT NULL DEFAULT 0
);
