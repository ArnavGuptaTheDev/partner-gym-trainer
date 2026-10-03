-- Daily logging: what was actually done/eaten on a given local date.

CREATE TABLE day_logs (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  calories_burned INTEGER,
  water_ml        INTEGER,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- name/equipment are snapshots so history survives plan edits.
CREATE TABLE exercise_logs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  plan_exercise_id TEXT REFERENCES plan_exercises(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  equipment        TEXT NOT NULL DEFAULT '',
  sets             INTEGER,
  reps             TEXT NOT NULL DEFAULT '',
  weight_kg        REAL,
  done             INTEGER NOT NULL DEFAULT 1 CHECK (done IN (0, 1)),
  notes            TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL
);
CREATE INDEX exercise_logs_user_date ON exercise_logs(user_id, date);
-- One check-off per planned exercise per day.
CREATE UNIQUE INDEX exercise_logs_plan_once ON exercise_logs(user_id, date, plan_exercise_id) WHERE plan_exercise_id IS NOT NULL;

CREATE TABLE meal_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  plan_meal_id TEXT REFERENCES plan_meals(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  calories     INTEGER,
  protein_g    INTEGER,
  carbs_g      INTEGER,
  fat_g        INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX meal_logs_user_date ON meal_logs(user_id, date);
