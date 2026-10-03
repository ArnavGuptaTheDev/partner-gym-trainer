-- Richer workout plans. Additive only: existing rows keep their values and
-- the new columns default to "empty", so plans saved before this render as
-- they did.

-- Exercises. `notes` (existing) is the coach's note / form tip. The legacy
-- `reps` text stays: it's shown when reps_min is NULL (older rows), and saves
-- keep writing a formatted copy of the structured reps into it.
ALTER TABLE plan_exercises ADD COLUMN alt_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_exercises ADD COLUMN muscles     TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_exercises ADD COLUMN reps_min    INTEGER;
ALTER TABLE plan_exercises ADD COLUMN reps_max    INTEGER;
ALTER TABLE plan_exercises ADD COLUMN reps_suffix TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_exercises ADD COLUMN icon        TEXT;                       -- validated in code (shared/plan.ts)
ALTER TABLE plan_exercises ADD COLUMN links_json  TEXT NOT NULL DEFAULT '[]'; -- up to 3 http(s) URLs

-- Plan header, e.g. "Sia ka Arnav" / "Personal bulk-up plan".
ALTER TABLE plans ADD COLUMN title   TEXT NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN tagline TEXT NOT NULL DEFAULT '';

-- Per-weekday settings. A day with same_as uses that day's exercise list
-- (no exercises of its own); chains and rest-day targets are rejected in code.
CREATE TABLE plan_days (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  title        TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  is_rest      INTEGER NOT NULL DEFAULT 0 CHECK (is_rest IN (0, 1)),
  rest_message TEXT NOT NULL DEFAULT '',
  same_as      INTEGER CHECK (same_as BETWEEN 0 AND 6 AND same_as <> weekday),
  PRIMARY KEY (user_id, weekday)
);

-- Exercise photos. Bytes live in R2 under r2_key and are only served by the
-- authenticated /api/plan-media/:id. Rows are uploaded unattached
-- (plan_exercise_id NULL) and attached by the next plan save; unattached
-- rows older than a day are removed lazily on upload and save.
CREATE TABLE plan_media (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- whose plan
  plan_exercise_id TEXT REFERENCES plan_exercises(id) ON DELETE SET NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  r2_key           TEXT NOT NULL UNIQUE,
  bytes            INTEGER NOT NULL,
  width            INTEGER,
  height           INTEGER,
  mime             TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp')),
  uploaded_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX plan_media_exercise ON plan_media(plan_exercise_id, position);
CREATE INDEX plan_media_user     ON plan_media(user_id, created_at);
CREATE INDEX plan_media_uploader ON plan_media(uploaded_by, created_at);
