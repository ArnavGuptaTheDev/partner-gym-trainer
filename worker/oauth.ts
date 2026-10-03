// Google OpenID Connect: authorization code flow with PKCE, done server-side.
import { b64url, pkceChallenge, randomToken } from './crypto';
import type { Env } from './types';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const OAUTH_COOKIE = 'spotter_oauth';
export const OAUTH_COOKIE_PATH = '/api/auth/google';
export const OAUTH_TTL_SEC = 600;

/** What we remember between /start and /callback, in an HttpOnly cookie. */
export interface OAuthState {
  state: string;
  verifier: string;
  nonce: string;
  invite?: string;
  next: string;
}

export interface GoogleClaims {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

/** Why a callback was refused; doubles as the ?error= code on /login. */
export type OAuthFailure = 'state' | 'google' | 'token' | 'unverified';

export class OAuthError extends Error {
  constructor(public code: OAuthFailure) {
    super(code);
  }
}

/**
 * Accepts only a same-origin relative path: one leading "/", no "//", no
 * backslashes, no scheme. Anything else becomes "/".
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw.length > 512) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/';
  // Final guard: it must resolve to the same origin and path it claims.
  const base = 'https://spotter.invalid';
  try {
    const u = new URL(raw, base);
    return u.origin === base ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

export function redirectUri(origin: string) {
  return `${origin}/api/auth/google/callback`;
}

export function newOAuthState(invite: string | undefined, next: string): OAuthState {
  return { state: randomToken(32), verifier: randomToken(48), nonce: randomToken(16), invite, next };
}

export function encodeOAuthCookie(s: OAuthState): string {
  const value = b64url(new TextEncoder().encode(JSON.stringify(s)));
  return `${OAUTH_COOKIE}=${value}; Path=${OAUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_TTL_SEC}`;
}

export const clearOAuthCookie = () => `${OAUTH_COOKIE}=; Path=${OAUTH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

export function readOAuthCookie(req: Request): OAuthState | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== OAUTH_COOKIE) continue;
    try {
      const s = JSON.parse(b64urlDecode(rest.join('='))) as OAuthState;
      if (typeof s.state === 'string' && typeof s.verifier === 'string' && typeof s.nonce === 'string') {
        return { ...s, next: safeNext(s.next) };
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

export async function googleAuthUrl(env: Env, origin: string, s: OAuthState): Promise<string> {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: 'openid email profile',
    state: s.state,
    nonce: s.nonce,
    code_challenge: await pkceChallenge(s.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${p}`;
}

/**
 * Exchanges the code for tokens and returns verified ID-token claims.
 *
 * The ID token comes straight from Google's token endpoint over TLS,
 * authenticated with our client secret, so its signature need not be
 * re-verified (OpenID Connect Core §3.1.3.7, item 6). The claims are.
 */
export async function exchangeCode(env: Env, origin: string, code: string, s: OAuthState, now: number): Promise<GoogleClaims> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(origin),
        grant_type: 'authorization_code',
        code_verifier: s.verifier,
      }),
    });
  } catch {
    throw new OAuthError('google');
  }
  if (!res.ok) throw new OAuthError('google');
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!body || typeof body.id_token !== 'string') throw new OAuthError('google');
  return verifyIdTokenClaims(decodeJwtPayload(body.id_token), env.GOOGLE_CLIENT_ID!, s.nonce, now);
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new OAuthError('token');
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]));
    if (typeof payload !== 'object' || payload === null) throw new Error();
    return payload;
  } catch {
    throw new OAuthError('token');
  }
}

export function verifyIdTokenClaims(c: Record<string, unknown>, clientId: string, nonce: string, now: number): GoogleClaims {
  const audOk = Array.isArray(c.aud) ? c.aud.length === 1 && c.aud[0] === clientId : c.aud === clientId;
  if (!audOk) throw new OAuthError('token');
  if (typeof c.iss !== 'string' || !GOOGLE_ISSUERS.includes(c.iss)) throw new OAuthError('token');
  if (typeof c.exp !== 'number' || c.exp * 1000 <= now) throw new OAuthError('token');
  if (c.nonce !== nonce) throw new OAuthError('token');
  if (typeof c.sub !== 'string' || !c.sub || typeof c.email !== 'string' || !c.email) throw new OAuthError('token');
  if (c.email_verified !== true) throw new OAuthError('unverified');
  return {
    sub: c.sub,
    email: c.email.toLowerCase(),
    name: typeof c.name === 'string' ? c.name.slice(0, 80) : '',
    picture: typeof c.picture === 'string' && c.picture.startsWith('https://') ? c.picture : null,
  };
}
