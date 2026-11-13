CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  lock_owner TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (
  hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_expiry ON oauth_states(expires_at);
CREATE INDEX oauth_session ON oauth_states(session_id);
-- Fixed-window quota keys are salted hashes, never raw IP addresses.
CREATE TABLE rate_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
