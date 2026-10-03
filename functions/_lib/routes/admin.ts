import { randomId, randomToken, sha256Hex } from '../crypto';
import { decodeCursor, page } from '../cursor';
import { badRequest, conflict, json, notFound, pageLimit, readJson } from '../http';
import type { Router } from '../router';
import { parse, v } from '../validate';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CreateInvite = v.object({ note: v.optional(v.string({ max: 100 })) });

interface InviteRow {
  id: string;
  note: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  used_by: string | null;
  used_by_name: string | null;
  used_by_email: string | null;
}

function inviteStatus(r: InviteRow, now: number) {
  if (r.used_by || r.used_at) return 'used';
  if (r.revoked_at) return 'revoked';
  if (r.expires_at <= now) return 'expired';
  return 'active';
}

export function registerAdminRoutes(r: Router) {
  r.post('/api/admin/invites', { auth: 'super' }, async (c) => {
    const body = parse(CreateInvite, await readJson(c.req));
    const token = randomToken(24);
    const id = randomId();
    const expiresAt = c.now + INVITE_TTL_MS;
    await c.env.DB.prepare(
      'INSERT INTO invites (id, token_hash, created_by, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, await sha256Hex(token), c.user.id, body.note ?? '', c.now, expiresAt)
      .run();
    // The raw token is only ever returned here; the DB stores its hash.
    return json(
      { id, token, url: `${c.url.origin}/join?invite=${encodeURIComponent(token)}`, expiresAt },
      { status: 201 },
    );
  });

  r.get('/api/admin/invites', { auth: 'super' }, async (c) => {
    const limit = pageLimit(c.url);
    const cur = decodeCursor(c.url.searchParams.get('cursor'));
    const { results } = await c.env.DB.prepare(
      `SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, i.revoked_at, i.used_by,
              u.display_name AS used_by_name, u.email AS used_by_email
       FROM invites i LEFT JOIN users u ON u.id = i.used_by
       WHERE ?1 IS NULL OR i.created_at < ?1 OR (i.created_at = ?1 AND i.id < ?2)
       ORDER BY i.created_at DESC, i.id DESC LIMIT ?3`,
    )
      .bind(cur?.key ?? null, cur?.id ?? '', limit + 1)
      .all<InviteRow>();
    const { items, nextCursor } = page(results, limit, (r) => [r.created_at, r.id]);
    return json({
      items: items.map((r) => ({
        id: r.id,
        note: r.note,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        revokedAt: r.revoked_at,
        status: inviteStatus(r, c.now),
        usedBy: r.used_by ? { id: r.used_by, displayName: r.used_by_name, email: r.used_by_email } : null,
      })),
      nextCursor,
    });
  });

  r.delete('/api/admin/invites/:id', { auth: 'super' }, async (c) => {
    const res = await c.env.DB.prepare(
      'UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL',
    )
      .bind(c.now, c.params.id)
      .run();
    if (!res.meta.changes) {
      const exists = await c.env.DB.prepare('SELECT 1 FROM invites WHERE id = ?').bind(c.params.id).first();
      if (!exists) throw notFound('No such invite.');
      throw conflict('That invite was already used or revoked.');
    }
    return json({ ok: true });
  });

  r.get('/api/admin/users', { auth: 'super' }, async (c) => {
    const limit = pageLimit(c.url);
    const cur = decodeCursor(c.url.searchParams.get('cursor'));
    const { results } = await c.env.DB.prepare(
      `SELECT id, email, display_name, is_active, created_at FROM users
       WHERE ?1 IS NULL OR created_at < ?1 OR (created_at = ?1 AND id < ?2)
       ORDER BY created_at DESC, id DESC LIMIT ?3`,
    )
      .bind(cur?.key ?? null, cur?.id ?? '', limit + 1)
      .all<{ id: string; email: string; display_name: string; is_active: number; created_at: number }>();
    const { items, nextCursor } = page(results, limit, (r) => [r.created_at, r.id]);
    return json({
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        isActive: !!u.is_active,
        createdAt: u.created_at,
      })),
      nextCursor,
    });
  });

  for (const action of ['deactivate', 'reactivate'] as const) {
    r.post(`/api/admin/users/:id/${action}`, { auth: 'super' }, async (c) => {
      const id = c.params.id;
      if (id === c.user.id) throw badRequest("You can't change your own account status.");
      const db = c.env.DB;
      const stmts = [db.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(action === 'reactivate' ? 1 : 0, id)];
      // Deactivation signs the user out everywhere immediately.
      if (action === 'deactivate') stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
      const [res] = await db.batch(stmts);
      if (!res.meta.changes) throw notFound('No such user.');
      return json({ ok: true });
    });
  }
}
