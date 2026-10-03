import { randomToken, sha256Hex } from './crypto';
import type { Env } from './types';

export const SESSION_COOKIE = 'spotter_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Sessions slide: on use, expiry moves to now + SESSION_TTL_MS, written at
 * most once per SESSION_RENEW_MS. The idle limit is therefore 30 days after
 * the last app open (push notifications follow the same limit).
 */
export const SESSION_RENEW_MS = 24 * 60 * 60 * 1000;

export function sessionCookie(token: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export const clearSessionCookie = () => sessionCookie('', 0);

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

/** Creates a session row and returns the raw token for the cookie. */
export async function createSession(env: Env, userId: string, now: number): Promise<string> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(hash, userId, now, now + SESSION_TTL_MS, now)
    .run();
  return token;
}
