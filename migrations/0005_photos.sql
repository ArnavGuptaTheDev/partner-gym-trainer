-- Photo metadata. Bytes live in the private R2 bucket under r2_key and are
-- only ever served through the authenticated /api/photos/:id function.

CREATE TABLE photos (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('gym', 'chat')),
  date       TEXT NOT NULL,
  r2_key     TEXT NOT NULL UNIQUE,
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp')),
  caption    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX photos_timeline ON photos(user_id, kind, created_at DESC);
CREATE INDEX photos_user_created ON photos(user_id, created_at);
