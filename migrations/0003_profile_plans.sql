-- Profiles, weight history, partner-set plans, and the activity feed.

CREATE TABLE profiles (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  height_cm        REAL,
  start_weight_kg  REAL,
  target_weight_kg REAL,
  goal_mode        TEXT CHECK (goal_mode IN ('lose', 'gain', 'maintain')),
  target_date      TEXT,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE weight_logs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- A plan belongs to the person it is FOR (user_id); updated_by is whoever
-- last edited it (normally their partner).
CREATE TABLE plans (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calorie_target INTEGER,
  calorie_goal   TEXT NOT NULL DEFAULT 'maintain' CHECK (calorie_goal IN ('deficit', 'surplus', 'maintain')),
  protein_g      INTEGER,
  carbs_g        INTEGER,
  fat_g          INTEGER,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE plan_meals (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name     TEXT NOT NULL,
  items    TEXT NOT NULL DEFAULT '',
  notes    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX plan_meals_user ON plan_meals(user_id, position);

CREATE TABLE plan_exercises (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday          INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  position         INTEGER NOT NULL,
  name             TEXT NOT NULL,
  equipment        TEXT NOT NULL DEFAULT '',
  sets             INTEGER,
  reps             TEXT NOT NULL DEFAULT '',
  target_weight_kg REAL,
  notes            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX plan_exercises_user ON plan_exercises(user_id, weekday, position);

-- One row per thing a user did. Drives the partner feed and streaks.
-- (type, ref_id) is unique per user so edits update rather than duplicate.
CREATE TABLE activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('workout', 'meal', 'photo', 'weight', 'day', 'plan', 'milestone')),
  ref_id     TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, type, ref_id)
);
CREATE INDEX activities_user ON activities(user_id, id DESC);
CREATE INDEX activities_user_date ON activities(user_id, date);
