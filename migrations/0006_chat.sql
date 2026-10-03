-- 1:1 chat. Messages belong to the pair and disappear with it on unpair;
-- attached photos belong to the sender (kind = 'chat').

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id    TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  photo_id   TEXT REFERENCES photos(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_pair ON messages(pair_id, id);

CREATE TABLE chat_reads (
  pair_id      TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pair_id, user_id)
);
