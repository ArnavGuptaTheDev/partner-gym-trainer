// Shared middleware: every API request passes through these in order
// (see app.ts). Route handlers can rely on the Ctx fields they fill in.
import { sha256Hex } from './crypto';
import { forbidden, notFound, unauthorized } from './http';
import type { RouteOpts } from './router';
import { readSessionToken, SESSION_RENEW_MS, SESSION_TTL_MS } from './session';
import type { Ctx, Env, Pair, User } from './types';

export function superEmails(env: Env): string[] {
  return (env.SUPER_USER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const isSuperEmail = (env: Env, email: string) => superEmails(env).includes(email.toLowerCase());

/**
 * Rejects cross-site mutations. SameSite=Lax already keeps the cookie off
 * cross-site POSTs; this is defence in depth for browsers that ignore it.
 */
export function checkOrigin(c: Ctx): void {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return;
  const origin = c.req.headers.get('origin');
  if (!origin) return; // Non-browser clients; the cookie rules still apply.
  const allowed = new Set([c.url.origin, ...(c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
  if (!allowed.has(origin)) throw forbidden('Cross-origin request rejected.');
}

/** Loads the session and user (and pair) in a single D1 round trip. */
export async function authenticate(c: Ctx): Promise<void> {
  const token = readSessionToken(c.req);
  if (!token) throw unauthorized();
  const hash = await sha256Hex(token);

  const [userRes, pairRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, u.is_active, u.timezone, u.units, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    ).bind(hash, c.now),
    c.env.DB.prepare(
      `SELECT p.*, u.display_name AS partner_name
       FROM sessions s
       JOIN pairs p ON p.user_a_id = s.user_id OR p.user_b_id = s.user_id
       JOIN users u ON u.id = CASE WHEN p.user_a_id = s.user_id THEN p.user_b_id ELSE p.user_a_id END
       WHERE s.token_hash = ?1`,
    ).bind(hash),
  ]);

  const row = userRes.results[0] as (User & { expires_at: number }) | undefined;
  if (!row || !row.is_active) throw unauthorized();

  const { expires_at, ...user } = row;
  c.user = user;
  c.sessionHash = hash;
  c.isSuper = isSuperEmail(c.env, user.email);
  const pairRow = pairRes.results[0] as (Pair & { partner_name: string }) | undefined;
  if (pairRow) {
    const { partner_name, ...pair } = pairRow;
    c.pair = pair;
    c.partnerId = pair.user_a_id === user.id ? pair.user_b_id : pair.user_a_id;
    c.partnerName = partner_name;
  } else {
    c.pair = null;
    c.partnerId = null;
    c.partnerName = null;
  }

  // Sliding expiry, written at most about twice a month per session.
  if (expires_at - c.now < SESSION_RENEW_MS) {
    c.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?')
        .bind(c.now + SESSION_TTL_MS, c.now, hash)
        .run(),
    );
  }
}

export function requireSuper(c: Ctx): void {
  if (!c.isSuper) throw forbidden('Super users only.');
}

/**
 * Resolves `:who` to a user id and enforces who may read or write it.
 * `me` is always the caller; `partner` requires an active pair.
 */
export function resolveWho(c: Ctx, mode: NonNullable<RouteOpts['who']>): void {
  const who = c.params.who;
  if (who === 'me') {
    c.subjectId = c.user.id;
    c.isSelf = true;
  } else if (who === 'partner') {
    if (!c.partnerId) throw notFound('You are not paired with anyone yet.');
    c.subjectId = c.partnerId;
    c.isSelf = false;
  } else {
    throw notFound();
  }

  const writing = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  if (!writing || mode === 'read') return;

  if (mode === 'self' && !c.isSelf) throw forbidden('You can only change your own log.');
  if (mode === 'plan' && c.isSelf && c.pair && !c.pair.allow_self_edit) {
    throw forbidden('Your partner sets your plan. Ask them to turn on self-editing.');
  }
}
