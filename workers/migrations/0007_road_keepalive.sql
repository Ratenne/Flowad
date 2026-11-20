CREATE TABLE road_keepalive_experiments (
  starts_at INTEGER PRIMARY KEY,
  ends_at INTEGER NOT NULL,
  last_slot INTEGER NOT NULL DEFAULT -1,
  attempts INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  rate_limits INTEGER NOT NULL DEFAULT 0,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  last_user_route_at INTEGER NOT NULL DEFAULT 0,
  user_attempts INTEGER NOT NULL DEFAULT 0,
  user_successes INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT
);
