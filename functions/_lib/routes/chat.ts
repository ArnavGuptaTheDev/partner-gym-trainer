import { badRequest, json, notFound, pageLimit, readJson } from '../http';
import type { Router } from '../router';
import type { Ctx, Pair } from '../types';
import { parse, v } from '../validate';

const SendBody = v.object({
  body: v.optional(v.string({ max: 2000 })),
  photoId: v.optional(v.string({ min: 1, max: 64 })),
});
const ReadBody = v.object({ lastId: v.number({ min: 0, int: true }) });

interface MessageRow {
  id: number;
  sender_id: string;
  body: string;
  photo_id: string | null;
  created_at: number;
}

const view = (m: MessageRow) => ({
  id: m.id,
  senderId: m.sender_id,
  body: m.body,
  photoUrl: m.photo_id ? `/api/photos/${m.photo_id}` : null,
  createdAt: m.created_at,
});

function requirePair(c: Ctx): Pair {
  if (!c.pair) throw notFound('Pair up to start chatting.');
  return c.pair;
}

/** Unread messages from the partner, capped at 99 so the count stays cheap. */
export function unreadStmt(db: D1Database, pairId: string, userId: string) {
  return db
    .prepare(
      `SELECT count(*) AS n FROM (
         SELECT 1 FROM messages
         WHERE pair_id = ?1 AND sender_id != ?2
           AND id > COALESCE((SELECT last_read_id FROM chat_reads WHERE pair_id = ?1 AND user_id = ?2), 0)
         LIMIT 99)`,
    )
    .bind(pairId, userId);
}

export function registerChatRoutes(r: Router) {
  // ?after=ID → newer messages (polling, ascending). Otherwise the latest page,
  // or the page before ?before=ID, returned oldest-first for display.
  r.get('/api/messages', {}, async (c) => {
    const pair = requirePair(c);
    const db = c.env.DB;
    const limit = pageLimit(c.url, 30, 50);
    const after = c.url.searchParams.get('after');
    const before = c.url.searchParams.get('before');

    const msgStmt = after
      ? db.prepare('SELECT * FROM messages WHERE pair_id = ? AND id > ? ORDER BY id ASC LIMIT ?').bind(pair.id, Number(after) || 0, limit + 1)
      : db
          .prepare('SELECT * FROM messages WHERE pair_id = ?1 AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3')
          .bind(pair.id, before ? Number(before) || 0 : null, limit + 1);

    const [msgs, reads] = await db.batch([
      msgStmt,
      db.prepare('SELECT last_read_id FROM chat_reads WHERE pair_id = ? AND user_id = ?').bind(pair.id, c.partnerId),
    ]);
    let rows = msgs.results as MessageRow[];
    const hasMore = rows.length > limit;
    rows = rows.slice(0, limit);
    if (!after) rows.reverse();

    return json({
      items: rows.map(view),
      hasMore,
      partnerLastReadId: (reads.results[0] as { last_read_id: number } | undefined)?.last_read_id ?? 0,
    });
  });

  r.post('/api/messages', {}, async (c) => {
    const pair = requirePair(c);
    const b = parse(SendBody, await readJson(c.req));
    const body = b.body ?? '';
    if (!body && !b.photoId) throw badRequest('body: write something or attach a photo', { field: 'body' });
    const db = c.env.DB;

    if (b.photoId) {
      const ok = await db
        .prepare("SELECT 1 FROM photos WHERE id = ? AND user_id = ? AND kind = 'chat'")
        .bind(b.photoId, c.user.id)
        .first();
      if (!ok) throw badRequest('photoId: not one of your chat photos', { field: 'photoId' });
    }

    const row = await db
      .prepare('INSERT INTO messages (pair_id, sender_id, body, photo_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .bind(pair.id, c.user.id, body, b.photoId ?? null, c.now)
      .first<MessageRow>();
    // Your own message counts as read.
    c.waitUntil(markRead(db, pair.id, c.user.id, row!.id));
    return json(view(row!), { status: 201 });
  });

  r.post('/api/messages/read', {}, async (c) => {
    const pair = requirePair(c);
    const { lastId } = parse(ReadBody, await readJson(c.req));
    await markRead(c.env.DB, pair.id, c.user.id, lastId);
    return json({ ok: true });
  });
}

function markRead(db: D1Database, pairId: string, userId: string, lastId: number) {
  return db
    .prepare(
      `INSERT INTO chat_reads (pair_id, user_id, last_read_id) VALUES (?1, ?2, ?3)
       ON CONFLICT(pair_id, user_id) DO UPDATE SET last_read_id = max(last_read_id, ?3)`,
    )
    .bind(pairId, userId, lastId)
    .run();
}
