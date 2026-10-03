import { randomId, sha256Hex, timingSafeEqual } from '../crypto';
import { HttpError, json, notFound, readJson } from '../http';
import { isSuperEmail } from '../middleware';
import {
  clearOAuthCookie,
  encodeOAuthCookie,
  exchangeCode,
  googleAuthUrl,
  newOAuthState,
  OAuthError,
  readOAuthCookie,
  safeNext,
  type GoogleClaims,
} from '../oauth';
import { rateLimit } from '../ratelimit';
import type { Router } from '../router';
import { clearSessionCookie, createSession, readSessionToken, sessionCookie } from '../session';
import type { Ctx } from '../types';
import { parse, v } from '../validate';
import { pairView } from './pair';

const DevLoginBody = v.object({ email: v.email() });
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function meResponse(c: Ctx) {
  return {
    user: {
      id: c.user.id,
      email: c.user.email,
      displayName: c.user.display_name,
      avatarUrl: c.user.avatar_url,
      timezone: c.user.timezone,
      units: c.user.units,
      isSuper: c.isSuper,
    },
    pair: pairView(c),
  };
}

/** 302 with any number of Set-Cookie headers. */
function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * The dev-only login is available only when DEV_LOGIN is exactly "true" AND
 * the request is addressed to localhost. Anything else fails closed (404),
 * so a stray production variable can't enable it.
 */
export function devLoginEnabled(c: Ctx): boolean {
  return c.env.DEV_LOGIN === 'true' && LOCAL_HOSTS.has(c.url.hostname);
}

type Outcome = { userId: string } | { refuse: 'invite_only' | 'deactivated' | 'email_taken' };

/** Invite-only account resolution. Users are identified by Google `sub` only. */
async function resolveUser(c: Ctx, g: GoogleClaims, inviteToken: string | undefined): Promise<Outcome> {
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id, is_active FROM users WHERE google_sub = ?').bind(g.sub).first<{ id: string; is_active: number }>();

  if (existing) {
    if (!existing.is_active) return { refuse: 'deactivated' };
    // Refresh Google profile data. Email follows Google unless another
    // account already holds it; display_name is the user's own and untouched.
    await db
      .prepare(
        `UPDATE users SET
           google_name = ?2, avatar_url = ?3,
           email = CASE WHEN EXISTS (SELECT 1 FROM users WHERE email = ?4 AND id != ?1) THEN email ELSE ?4 END
         WHERE id = ?1`,
      )
      .bind(existing.id, g.name, g.picture, g.email)
      .run();
    return { userId: existing.id };
  }

  const userId = randomId();
  const displayName = (g.name || g.email.split('@')[0]).slice(0, 40);
  const cols = 'id, google_sub, email, display_name, google_name, avatar_url, invite_id, created_at';

  try {
    if (isSuperEmail(c.env, g.email)) {
      await db
        .prepare(`INSERT INTO users (${cols}) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`)
        .bind(userId, g.sub, g.email, displayName, g.name, g.picture, c.now)
        .run();
      return { userId };
    }

    if (!inviteToken) return { refuse: 'invite_only' };
    const invite = await db
      .prepare('SELECT id FROM invites WHERE token_hash = ? AND used_by IS NULL AND revoked_at IS NULL AND expires_at > ?')
      .bind(await sha256Hex(inviteToken), c.now)
      .first<{ id: string }>();
    if (!invite) return { refuse: 'invite_only' };

    // Create the account only if the invite is still unclaimed, then claim
    // it, in one transaction: two callbacks racing on one invite can't both win.
    const [ins] = await db.batch([
      db
        .prepare(
          `INSERT INTO users (${cols})
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
           WHERE EXISTS (SELECT 1 FROM invites WHERE id = ?7 AND used_by IS NULL AND revoked_at IS NULL AND expires_at > ?8)`,
        )
        .bind(userId, g.sub, g.email, displayName, g.name, g.picture, invite.id, c.now),
      db
        .prepare(
          `UPDATE invites SET used_by = ?1, used_at = ?2
           WHERE id = ?3 AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?1)`,
        )
        .bind(userId, c.now, invite.id),
    ]);
    return ins.meta.changes ? { userId } : { refuse: 'invite_only' };
  } catch (e) {
    // A concurrent first login with the same sub: the other request created
    // the account, so this one simply logs in. An email already held by a
    // different Google account is refused, never matched.
    if (/UNIQUE.*google_sub/.test(String(e))) return resolveUser(c, g, undefined);
    if (/UNIQUE.*email/.test(String(e))) return { refuse: 'email_taken' };
    throw e;
  }
}

export function registerAuthRoutes(r: Router) {
  r.get('/api/auth/google/start', { auth: 'public' }, async (c) => {
    await rateLimit(c, 'oauthStart');
    if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return redirect('/login?error=config');
    const invite = c.url.searchParams.get('invite')?.slice(0, 200) || undefined;
    const s = newOAuthState(invite, safeNext(c.url.searchParams.get('next')));
    return redirect(await googleAuthUrl(c.env, c.url.origin, s), [encodeOAuthCookie(s)]);
  });

  r.get('/api/auth/google/callback', { auth: 'public' }, async (c) => {
    await rateLimit(c, 'oauthCallback');
    const clear = clearOAuthCookie();
    const saved = readOAuthCookie(c.req);
    const params = c.url.searchParams;

    if (params.get('error')) return redirect('/login?error=cancelled', [clear]);
    const state = params.get('state') ?? '';
    const code = params.get('code') ?? '';
    if (!saved || !state || !code || !timingSafeEqual(state, saved.state)) return redirect('/login?error=state', [clear]);
    if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return redirect('/login?error=config', [clear]);

    let claims: GoogleClaims;
    try {
      claims = await exchangeCode(c.env, c.url.origin, code, saved, c.now);
    } catch (e) {
      if (e instanceof OAuthError) return redirect(`/login?error=${e.code}`, [clear]);
      throw e;
    }

    const outcome = await resolveUser(c, claims, saved.invite);
    if ('refuse' in outcome) {
      return redirect(outcome.refuse === 'invite_only' ? '/invite-only' : `/login?error=${outcome.refuse}`, [clear]);
    }
    const token = await createSession(c.env, outcome.userId, c.now);
    return redirect(saved.next, [clear, sessionCookie(token)]);
  });

  // Dev-only: sign in a seeded user by email. See devLoginEnabled().
  r.get('/api/auth/dev-login', { auth: 'public' }, async (c) => {
    if (!devLoginEnabled(c)) throw notFound('No such endpoint.');
    return json({ enabled: true });
  });

  r.post('/api/auth/dev-login', { auth: 'public' }, async (c) => {
    if (!devLoginEnabled(c)) throw notFound('No such endpoint.');
    const { email } = parse(DevLoginBody, await readJson(c.req));
    const user = await c.env.DB.prepare('SELECT id, is_active FROM users WHERE email = ?').bind(email).first<{ id: string; is_active: number }>();
    if (!user) throw notFound('No user with that email. Did you run the seed script?');
    if (!user.is_active) throw new HttpError(403, 'deactivated', 'This account has been deactivated.');
    const token = await createSession(c.env, user.id, c.now);
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
