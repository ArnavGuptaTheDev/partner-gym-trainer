import { removeActivity, upsertActivity } from '../activity';
import { randomId } from '../crypto';
import { decodeCursor, page } from '../cursor';
import { assertLogDate } from '../dates';
import { HttpError, json, notFound, pageLimit } from '../http';
import { pushText } from '../push/messages';
import { notifyPartner } from '../push/send';
import type { Router } from '../router';
import type { Ctx } from '../types';
import { extFor, intField, readImageUpload, streamImage } from '../upload';
import { parse, v } from '../validate';

export { MAX_PHOTO_BYTES } from '../upload';
export const MAX_UPLOADS_PER_DAY = 10;
const DAY_MS = 86_400_000;

const UploadMeta = v.object({
  kind: v.enum(['gym', 'chat'] as const),
  date: v.date(),
  caption: v.optional(v.string({ max: 200 })),
  width: v.optional(v.number({ min: 1, max: 4000, int: true })),
  height: v.optional(v.number({ min: 1, max: 4000, int: true })),
});

interface PhotoRow {
  id: string;
  user_id: string;
  kind: 'gym' | 'chat';
  date: string;
  r2_key: string;
  bytes: number;
  width: number | null;
  height: number | null;
  mime: string;
  caption: string;
  created_at: number;
}

export const photoView = (p: PhotoRow) => ({
  id: p.id,
  userId: p.user_id,
  date: p.date,
  url: `/api/photos/${p.id}`,
  width: p.width,
  height: p.height,
  caption: p.caption,
  createdAt: p.created_at,
});

/** Photos are visible to their owner and (while paired) the owner's partner. */
export function canSeePhoto(c: Ctx, ownerId: string) {
  return ownerId === c.user.id || (c.partnerId !== null && ownerId === c.partnerId);
}

export function registerPhotoRoutes(r: Router) {
  r.post('/api/u/:who/photos', { who: 'self' }, async (c) => {
    const { bytes, mime, form } = await readImageUpload(c);
    const meta = parse(UploadMeta, {
      kind: form.get('kind'),
      date: form.get('date'),
      caption: form.get('caption') ?? undefined,
      width: intField(form, 'width'),
      height: intField(form, 'height'),
    });
    assertLogDate(meta.date, c.now);

    const db = c.env.DB;
    const recent = await db
      .prepare('SELECT count(*) AS n FROM photos WHERE user_id = ? AND created_at > ?')
      .bind(c.user.id, c.now - DAY_MS)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_UPLOADS_PER_DAY) {
      throw new HttpError(429, 'upload_limit', `You can upload up to ${MAX_UPLOADS_PER_DAY} photos a day. Try again tomorrow.`);
    }

    const id = randomId();
    const key = `u/${c.user.id}/${id}.${extFor(mime)}`;
    await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: mime } });

    const row: PhotoRow = {
      id,
      user_id: c.user.id,
      kind: meta.kind,
      date: meta.date,
      r2_key: key,
      bytes: bytes.byteLength,
      width: meta.width ?? null,
      height: meta.height ?? null,
      mime,
      caption: meta.caption ?? '',
      created_at: c.now,
    };
    const stmts = [
      db
        .prepare(
          `INSERT INTO photos (id, user_id, kind, date, r2_key, bytes, width, height, mime, caption, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(row.id, row.user_id, row.kind, row.date, row.r2_key, row.bytes, row.width, row.height, row.mime, row.caption, row.created_at),
    ];
    if (meta.kind === 'gym') {
      stmts.push(upsertActivity(db, { userId: c.user.id, type: 'photo', refId: id, date: meta.date, summary: { photoId: id, caption: row.caption }, now: c.now }));
    }
    try {
      await db.batch(stmts);
    } catch (e) {
      await c.env.PHOTOS.delete(key); // don't leave orphaned bytes
      throw e;
    }
    if (meta.kind === 'gym') notifyPartner(c, 'photo', () => pushText.photo(c.user.display_name));
    return json(photoView(row), { status: 201 });
  });

  // Gym photo timeline, newest first.
  r.get('/api/u/:who/photos', { who: 'read' }, async (c) => {
    const limit = pageLimit(c.url, 24, 48);
    const cur = decodeCursor(c.url.searchParams.get('cursor'));
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM photos WHERE user_id = ?1 AND kind = 'gym'
         AND (?2 IS NULL OR created_at < ?2 OR (created_at = ?2 AND id < ?3))
       ORDER BY created_at DESC, id DESC LIMIT ?4`,
    )
      .bind(c.subjectId, cur?.key ?? null, cur?.id ?? '', limit + 1)
      .all<PhotoRow>();
    const { items, nextCursor } = page(results, limit, (p) => [p.created_at, p.id]);
    return json({ items: items.map(photoView), nextCursor });
  });

  // The only way gym/chat photo bytes leave R2.
  r.get('/api/photos/:id', {}, async (c) => {
    const row = await c.env.DB.prepare('SELECT user_id, r2_key, mime FROM photos WHERE id = ?')
      .bind(c.params.id)
      .first<{ user_id: string; r2_key: string; mime: string }>();
    // Same 404 for "missing" and "not yours" so ids can't be probed.
    if (!row || !canSeePhoto(c, row.user_id)) throw notFound();
    return streamImage(c, c.params.id, row.r2_key, row.mime);
  });

  r.delete('/api/u/:who/photos/:id', { who: 'self' }, async (c) => {
    const db = c.env.DB;
    const row = await db.prepare('SELECT r2_key FROM photos WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id).first<{ r2_key: string }>();
    if (!row) throw notFound();
    await db.batch([
      db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id),
      removeActivity(db, c.user.id, 'photo', c.params.id),
    ]);
    await c.env.PHOTOS.delete(row.r2_key);
    return json({ ok: true });
  });

  r.get('/api/admin/storage', { auth: 'super' }, async (c) => {
    const db = c.env.DB;
    const [photos, media, perUser] = await db.batch([
      db.prepare('SELECT COALESCE(sum(bytes), 0) AS bytes, count(*) AS count FROM photos'),
      db.prepare('SELECT COALESCE(sum(bytes), 0) AS bytes, count(*) AS count FROM plan_media'),
      db.prepare(
        `SELECT u.display_name AS displayName, sum(x.bytes) AS bytes, count(*) AS count
         FROM (SELECT user_id, bytes FROM photos UNION ALL SELECT user_id, bytes FROM plan_media) x
         JOIN users u ON u.id = x.user_id GROUP BY x.user_id ORDER BY bytes DESC LIMIT 20`,
      ),
    ]);
    const p = photos.results[0] as { bytes: number; count: number };
    const m = media.results[0] as { bytes: number; count: number };
    return json({
      totalBytes: p.bytes + m.bytes,
      photoCount: p.count,
      planMediaBytes: m.bytes,
      planMediaCount: m.count,
      users: perUser.results,
    });
  });
}
