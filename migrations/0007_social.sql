-- Reactions, nudges, notes of the day, and milestones.
-- Pair-scoped rows cascade away on unpair.

CREATE TABLE reactions (
  id          TEXT PRIMARY KEY,
  pair_id     TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  from_user   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (from_user, activity_id, emoji)
);
CREATE INDEX reactions_activity ON reactions(activity_id);

CREATE TABLE nudges (
  id         TEXT PRIMARY KEY,
  pair_id    TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  from_user  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('proud', 'gym')),
  created_at INTEGER NOT NULL,
  seen_at    INTEGER
);
CREATE INDEX nudges_to ON nudges(to_user, seen_at, created_at);

CREATE TABLE day_notes (
  pair_id    TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  to_user    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  from_user  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (to_user, date)
);

CREATE TABLE milestones (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('first_kg', 'halfway', 'target', 'streak_7', 'streak_30', 'streak_100')),
  achieved_at INTEGER NOT NULL,
  seen_at     INTEGER,
  PRIMARY KEY (user_id, kind)
);
