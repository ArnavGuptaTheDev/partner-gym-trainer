-- Web Push notifications. Additive only.

-- One row per device; a user can have several. Each subscription belongs to
-- the session that registered it, so logout, deactivation (which ends
-- sessions) and account deletion remove the device's subscription via
-- cascade. The app re-registers on every load, which rebinds the row to the
-- current session and picks up rotated endpoints.
CREATE TABLE push_subscriptions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash    TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,            -- browser's ECDH public key (base64url)
  auth            TEXT NOT NULL,            -- browser's auth secret (base64url)
  user_agent      TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  last_success_at INTEGER
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX push_subscriptions_session ON push_subscriptions(session_hash);

-- Notification settings. No row: notifications were never enabled.
CREATE TABLE push_prefs (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),  -- master toggle
  message       INTEGER NOT NULL DEFAULT 1 CHECK (message IN (0, 1)),
  nudge         INTEGER NOT NULL DEFAULT 1 CHECK (nudge IN (0, 1)),
  photo         INTEGER NOT NULL DEFAULT 1 CHECK (photo IN (0, 1)),
  plan          INTEGER NOT NULL DEFAULT 1 CHECK (plan IN (0, 1)),
  note          INTEGER NOT NULL DEFAULT 1 CHECK (note IN (0, 1)),
  milestone     INTEGER NOT NULL DEFAULT 1 CHECK (milestone IN (0, 1)),
  workout       INTEGER NOT NULL DEFAULT 1 CHECK (workout IN (0, 1)),
  hide_previews INTEGER NOT NULL DEFAULT 0 CHECK (hide_previews IN (0, 1)),
  updated_at    INTEGER NOT NULL
);

-- Notifications that must fire at most once (e.g. 'workout:2026-10-03').
CREATE TABLE push_once (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
