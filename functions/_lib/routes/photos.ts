import { removeActivity, upsertActivity } from '../activity';
import { randomId } from '../crypto';
import { decodeCursor, page } from '../cursor';
import { assertLogDate } from '../dates';
import { badRequest, HttpError, json, notFound, pageLimit } from '../http';
import { hasMetadata, sniffMime } from '../image';
import type { Router } from '../router';
import type { Ctx } from '../types';
import { parse, v } from '../validate';

export const MAX_PHOTO_BYTES = 1024 * 1024;
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
    const declared = Number(c.req.headers.get('content-length') ?? 0);
    if (declared > MAX_PHOTO_BYTES + 16 * 1024) throw new HttpError(413, 'too_large', 'Photos must be 1 MB or smaller after compression.');
    if (!(c.req.headers.get('content-type') ?? '').includes('multipart/form-data')) throw badRequest('Expected multipart/form-data.');

    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw badRequest('file: is required', { field: 'file' });
    const meta = parse(UploadMeta, {
      kind: form.get('kind'),
      date: form.get('date'),
      caption: form.get('caption') ?? undefined,
      width: form.get('width') ? Number(form.get('width')) : undefined,
      height: form.get('height') ? Number(form.get('height')) : undefined,
    });
    assertLogDate(meta.date, c.now);
    if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, 'too_large', 'Photos must be 1 MB or smaller after compression.');

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) throw new HttpError(415, 'unsupported', 'Only JPEG or WebP photos are accepted.');
    if (hasMetadata(bytes, mime)) throw badRequest('This photo still has location/camera metadata. Please re-upload from the app.');

    const db = c.env.DB;
    const recent = await db
      .prepare('SELECT count(*) AS n FROM photos WHERE user_id = ? AND created_at > ?')
      .bind(c.user.id, c.now - DAY_MS)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_UPLOADS_PER_DAY) {
      throw new HttpError(429, 'upload_limit', `You can upload up to ${MAX_UPLOADS_PER_DAY} photos a day. Try again tomorrow.`);
    }

    const id = randomId();
    const key = `u/${c.user.id}/${id}.${mime === 'image/webp' ? 'webp' : 'jpg'}`;
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

  // The only way photo bytes leave R2.
  r.get('/api/photos/:id', {}, async (c) => {
    const row = await c.env.DB.prepare('SELECT user_id, r2_key, mime FROM photos WHERE id = ?')
      .bind(c.params.id)
      .first<{ user_id: string; r2_key: string; mime: string }>();
    // Same 404 for "missing" and "not yours" so ids can't be probed.
    if (!row || !canSeePhoto(c, row.user_id)) throw notFound();

    const etag = `"${c.params.id}"`;
    const headers = {
      'content-type': row.mime,
      'cache-control': 'private, max-age=86400, immutable',
      etag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    };
    if (c.req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    const obj = await c.env.PHOTOS.get(row.r2_key);
    if (!obj) throw notFound();
    return new Response(obj.body, { headers: { ...headers, 'content-length': String(obj.size) } });
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
    const [total, perUser] = await db.batch([
      db.prepare('SELECT COALESCE(sum(bytes), 0) AS totalBytes, count(*) AS photoCount FROM photos'),
      db.prepare(
        `SELECT u.display_name AS displayName, sum(p.bytes) AS bytes, count(*) AS count
         FROM photos p JOIN users u ON u.id = p.user_id GROUP BY p.user_id ORDER BY bytes DESC LIMIT 20`,
      ),
    ]);
    return json({ ...(total.results[0] as object), users: perUser.results });
  });
}
