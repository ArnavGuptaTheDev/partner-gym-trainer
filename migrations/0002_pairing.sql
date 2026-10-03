-- Strict one-to-one pairing.

CREATE TABLE pairing_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pair_type  TEXT NOT NULL CHECK (pair_type IN ('couple', 'friends')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE pairs (
  id              TEXT PRIMARY KEY,
  user_a_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  user_b_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pair_type       TEXT NOT NULL CHECK (pair_type IN ('couple', 'friends')),
  allow_self_edit INTEGER NOT NULL DEFAULT 0 CHECK (allow_self_edit IN (0, 1)),
  together_since  TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (user_a_id <> user_b_id)
);

-- Per-column UNIQUE still lets someone be user_a in one pair and user_b in
-- another. This closes that gap at the database level.
CREATE TRIGGER pairs_one_partner_each
BEFORE INSERT ON pairs
WHEN EXISTS (
  SELECT 1 FROM pairs
  WHERE user_a_id IN (NEW.user_a_id, NEW.user_b_id)
     OR user_b_id IN (NEW.user_a_id, NEW.user_b_id)
)
BEGIN
  SELECT RAISE(ABORT, 'already_paired');
END;

CREATE TRIGGER pairs_no_member_change
BEFORE UPDATE OF user_a_id, user_b_id ON pairs
BEGIN
  SELECT RAISE(ABORT, 'pair_members_immutable');
END;
