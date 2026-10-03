import { hashPassword, randomId, sha256Hex, verifyPassword, PBKDF2_ITERATIONS } from '../crypto';
import { conflict, HttpError, json, readJson } from '../http';
import { isSuperEmail } from '../middleware';
import { pairView } from './pair';
import { rateLimit } from '../ratelimit';
import type { Router } from '../router';
import { clearSessionCookie, createSession, readSessionToken, sessionCookie } from '../session';
import type { Ctx } from '../types';
import { parse, v } from '../validate';

const RegisterBody = v.object({
  email: v.email(),
  password: v.string({ min: 10, max: 200, trim: false }),
  displayName: v.string({ min: 1, max: 40 }),
  inviteToken: v.optional(v.string({ max: 100 })),
  timezone: v.optional(v.string({ max: 64 })),
});

const LoginBody = v.object({
  email: v.email(),
  password: v.string({ min: 1, max: 200, trim: false }),
});

// Verified against on unknown emails so response time doesn't reveal
// whether an account exists.
const DUMMY = { hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', salt: 'AAAAAAAAAAAAAAAAAAAAAA==' };

const invalidInvite = () => new HttpError(410, 'invite_invalid', 'This invite link is invalid, used, or expired.');

export function meResponse(c: Ctx) {
  return {
    user: {
      id: c.user.id,
      email: c.user.email,
      displayName: c.user.display_name,
      timezone: c.user.timezone,
      units: c.user.units,
      isSuper: c.isSuper,
    },
    pair: pairView(c),
  };
}

export function registerAuthRoutes(r: Router) {
  r.post('/api/auth/register', { auth: 'public' }, async (c) => {
    await rateLimit(c, 'register');
    const body = parse(RegisterBody, await readJson(c.req));
    const isSuper = isSuperEmail(c.env, body.email);
    const db = c.env.DB;

    let inviteId: string | null = null;
    if (!isSuper) {
      if (!body.inviteToken) throw new HttpError(403, 'invite_required', 'Spotter is invite-only. You need an invite link.');
      const invite = await db
        .prepare('SELECT id FROM invites WHERE token_hash = ? AND used_by IS NULL AND revoked_at IS NULL AND expires_at > ?')
        .bind(await sha256Hex(body.inviteToken), c.now)
        .first<{ id: string }>();
      if (!invite) throw invalidInvite();
      inviteId = invite.id;
    }

    const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(body.email).first();
    if (existing) throw conflict('An account with that email already exists.');

    const pw = await hashPassword(body.password);
    const userId = randomId();
    const tz = body.timezone ?? 'UTC';

    if (inviteId) {
      // Insert only if the invite is still unclaimed, then claim it, in one
      // transaction, so two people racing on the same link can't both win.
      const [ins] = await db.batch([
        db
          .prepare(
            `INSERT INTO users (id, email, display_name, pw_hash, pw_salt, pw_iter, invite_id, timezone, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
             WHERE EXISTS (SELECT 1 FROM invites WHERE id = ?7 AND used_by IS NULL AND revoked_at IS NULL AND expires_at > ?9)`,
          )
          .bind(userId, body.email, body.displayName, pw.hash, pw.salt, pw.iterations, inviteId, tz, c.now),
        db
          .prepare(
            `UPDATE invites SET used_by = ?1, used_at = ?2
             WHERE id = ?3 AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?1)`,
          )
          .bind(userId, c.now, inviteId),
      ]);
      if (!ins.meta.changes) throw invalidInvite();
    } else {
      await db
        .prepare(
          `INSERT INTO users (id, email, display_name, pw_hash, pw_salt, pw_iter, timezone, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, body.email, body.displayName, pw.hash, pw.salt, pw.iterations, tz, c.now)
        .run();
    }

    const token = await createSession(c.env, userId, c.now);
    return json(
      { user: { id: userId, email: body.email, displayName: body.displayName, isSuper } },
      { status: 201, headers: { 'set-cookie': sessionCookie(token) } },
    );
  });

  r.post('/api/auth/login', { auth: 'public' }, async (c) => {
    await rateLimit(c, 'login');
    const body = parse(LoginBody, await readJson(c.req));
    const row = await c.env.DB.prepare('SELECT id, pw_hash, pw_salt, pw_iter, is_active FROM users WHERE email = ?')
      .bind(body.email)
      .first<{ id: string; pw_hash: string; pw_salt: string; pw_iter: number; is_active: number }>();

    const ok = row
      ? await verifyPassword(body.password, row.pw_hash, row.pw_salt, row.pw_iter)
      : (await verifyPassword(body.password, DUMMY.hash, DUMMY.salt, PBKDF2_ITERATIONS), false);

    if (!row || !ok) throw new HttpError(401, 'bad_credentials', 'Email or password is incorrect.');
    if (!row.is_active) throw new HttpError(403, 'deactivated', 'This account has been deactivated.');

    const token = await createSession(c.env, row.id, c.now);
    return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(token) } });
  });

  r.post('/api/auth/logout', { auth: 'public' }, async (c) => {
    const token = readSessionToken(c.req);
    if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } });
  });

  r.get('/api/auth/me', {}, async (c) => json(meResponse(c)));

  r.get('/api/invites/:token', { auth: 'public' }, async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT expires_at FROM invites WHERE token_hash = ? AND used_by IS NULL AND revoked_at IS NULL AND expires_at > ?',
    )
      .bind(await sha256Hex(c.params.token), c.now)
      .first<{ expires_at: number }>();
    return json({ valid: !!row, expiresAt: row?.expires_at ?? null });
  });
}
