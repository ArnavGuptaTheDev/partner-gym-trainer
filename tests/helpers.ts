import { env } from 'cloudflare:test';
import { handle } from '../worker/app';
import { b64url } from '../worker/crypto';
import { GOOGLE_TOKEN_URL } from '../worker/oauth';
import type { Env } from '../worker/types';

export const BASE = 'https://spotter.test';
export const CLIENT_ID = 'test-client.apps.googleusercontent.com';

let counter = 0;
const next = () => ++counter;

/** Each call gets its own IP so rate limits don't bleed between tests. */
export const uniqueIp = () => `10.${(next() >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now().toString(36)}.${next()}@example.com`;
export const uniqueSub = () => `${Date.now()}${next()}`.padEnd(21, '0');

export interface ApiOpts {
  body?: unknown;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
  rawBody?: BodyInit;
  /** Override the request origin, e.g. http://localhost:4321. */
  base?: string;
  /** Extra/overridden env vars for this request. */
  env?: Partial<Env>;
}

export interface ApiResult<T = any> {
  status: number;
  data: T;
  /** `spotter_session=…` if the response set one. */
  cookie?: string;
  setCookies: string[];
  location: string | null;
  res: Response;
}

export async function api<T = any>(method: string, path: string, opts: ApiOpts = {}): Promise<ApiResult<T>> {
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  if (opts.cookie) headers.set('cookie', opts.cookie);
  headers.set('cf-connecting-ip', opts.ip ?? uniqueIp());

  const pending: Promise<unknown>[] = [];
  const reqEnv = opts.env ? ({ ...env, ...opts.env } as Env) : (env as unknown as Env);
  const res = await handle(new Request((opts.base ?? BASE) + path, { method, headers, body, redirect: 'manual' }), reqEnv, (p) => pending.push(p));
  await Promise.all(pending);

  const setCookies = res.headers.getSetCookie();
  const session = setCookies.map((c) => c.match(/^spotter_session=([^;]+)/)?.[1]).find(Boolean);
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.clone().json() : null;
  return {
    status: res.status,
    data: data as T,
    cookie: session ? `spotter_session=${session}` : undefined,
    setCookies,
    location: res.headers.get('location'),
    res,
  };
}

// ---------------------------------------------------------------------------
// Fake Google token endpoint. Each authorization `code` maps to the ID-token
// claims Google would return for it; every other fetch goes to the network.

const pendingCodes = new Map<string, Record<string, unknown>>();
export const tokenRequests: URLSearchParams[] = [];
let tokenFailure: number | null = null;

export const failNextTokenExchange = (status = 400) => (tokenFailure = status);

export function installGoogleMock() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== GOOGLE_TOKEN_URL) return realFetch(input, init);
    const form = new URLSearchParams(String(init?.body ?? ''));
    tokenRequests.push(form);
    if (tokenFailure) {
      const status = tokenFailure;
      tokenFailure = null;
      return Response.json({ error: 'invalid_grant' }, { status });
    }
    const claims = pendingCodes.get(form.get('code') ?? '');
    if (!claims) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    pendingCodes.delete(form.get('code')!);
    const idToken = `${b64url(new TextEncoder().encode('{"alg":"RS256"}'))}.${b64url(new TextEncoder().encode(JSON.stringify(claims)))}.sig`;
    return Response.json({ access_token: 'at', id_token: idToken, token_type: 'Bearer', expires_in: 3599 });
  }) as typeof fetch;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  /** Overrides/extra claims, e.g. { email_verified: false } or { aud: 'x' }. */
  claims?: Record<string, unknown>;
}

export interface StartedFlow {
  oauthCookie: string;
  state: string;
  nonce: string;
  challenge: string;
  googleUrl: URL;
  start: ApiResult;
}

/** GET /start: returns the cookie and the parameters sent to Google. */
export async function startOAuth(query: Record<string, string> = {}, opts: ApiOpts = {}): Promise<StartedFlow> {
  const qs = new URLSearchParams(query).toString();
  const start = await api('GET', `/api/auth/google/start${qs ? `?${qs}` : ''}`, opts);
  const cookie = start.setCookies.find((c) => c.startsWith('spotter_oauth='));
  if (start.status !== 302 || !cookie || !start.location) throw new Error(`start failed: ${start.status} ${start.location}`);
  const googleUrl = new URL(start.location);
  return {
    oauthCookie: cookie.split(';')[0],
    state: googleUrl.searchParams.get('state')!,
    nonce: googleUrl.searchParams.get('nonce')!,
    challenge: googleUrl.searchParams.get('code_challenge')!,
    googleUrl,
    start,
  };
}

/** Simulates Google redirecting back with a code for `who`. */
export async function finishOAuth(flow: StartedFlow, who: GoogleIdentity, opts: ApiOpts & { state?: string } = {}) {
  const code = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  pendingCodes.set(code, {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    iat: now,
    exp: now + 3600,
    nonce: flow.nonce,
    sub: who.sub,
    email: who.email,
    email_verified: true,
    name: who.name ?? 'Test User',
    picture: who.picture ?? 'https://lh3.googleusercontent.com/a/test',
    ...who.claims,
  });
  const state = opts.state ?? flow.state;
  return api('GET', `/api/auth/google/callback?code=${code}&state=${encodeURIComponent(state)}`, {
    ...opts,
    cookie: [flow.oauthCookie, opts.cookie].filter(Boolean).join('; '),
  });
}

/** Full sign-in round trip. */
export async function googleLogin(who: GoogleIdentity, query: Record<string, string> = {}) {
  return finishOAuth(await startOAuth(query), who);
}

// ---------------------------------------------------------------------------

/** Signs in (creating on first use) a SUPER_USER_EMAILS user; returns a cookie. */
export async function superCookie(email = 'boss@example.com'): Promise<string> {
  const res = await googleLogin({ sub: `sub-${email.toLowerCase()}`, email, name: 'Boss' });
  if (!res.cookie) throw new Error(`super login failed: ${res.status} ${res.location}`);
  return res.cookie;
}

export async function createInvite(cookie: string, note?: string): Promise<{ id: string; token: string }> {
  const res = await api('POST', '/api/admin/invites', { cookie, body: { note } });
  if (res.status !== 201) throw new Error(`invite failed: ${res.status}`);
  return res.data;
}

export interface TestUser {
  id: string;
  sub: string;
  email: string;
  cookie: string;
}

/** Creates an invited, signed-in regular user. */
export async function newUser(name = 'Sam'): Promise<TestUser> {
  const { token } = await createInvite(await superCookie());
  const who = { sub: uniqueSub(), email: uniqueEmail(name.toLowerCase()), name };
  const res = await googleLogin(who, { invite: token });
  if (!res.cookie) throw new Error(`sign-up failed: ${res.status} ${res.location}`);
  const me = await api('GET', '/api/auth/me', { cookie: res.cookie });
  return { id: me.data.user.id, sub: who.sub, email: who.email, cookie: res.cookie };
}

/** Pairs two users via a code; `a` creates it, `b` joins. */
export async function pairUp(a: TestUser, b: TestUser, pairType: 'couple' | 'friends' = 'friends') {
  const code = await api('POST', '/api/pair/code', { cookie: a.cookie, body: { pairType } });
  if (code.status !== 201) throw new Error(`code failed: ${code.status}`);
  const join = await api('POST', '/api/pair/join', { cookie: b.cookie, body: { code: code.data.code } });
  if (join.status !== 201) throw new Error(`join failed: ${join.status} ${JSON.stringify(join.data)}`);
  return join.data.pairId as string;
}

/** Two freshly registered users, already paired. */
export async function newPair(pairType: 'couple' | 'friends' = 'friends') {
  const a = await newUser('Alex');
  const b = await newUser('Blake');
  const pairId = await pairUp(a, b, pairType);
  return { a, b, pairId };
}

export { env };
