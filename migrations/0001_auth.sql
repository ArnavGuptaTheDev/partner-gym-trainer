-- Accounts, sessions, invites and rate limiting.
-- Times are unix milliseconds. IDs are random text ids generated in code.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pw_hash      TEXT NOT NULL,
  pw_salt      TEXT NOT NULL,
  pw_iter      INTEGER NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  invite_id    TEXT,
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  units        TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  used_at    INTEGER,
  revoked_at INTEGER
);
CREATE INDEX invites_created ON invites(created_at DESC);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
