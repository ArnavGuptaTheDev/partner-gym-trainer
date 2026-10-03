import { env } from 'cloudflare:test';
import { handle } from '../functions/_lib/app';

export const BASE = 'https://spotter.test';

let counter = 0;
const next = () => ++counter;

/** Each call gets its own IP so rate limits don't bleed between tests. */
export const uniqueIp = () => `10.${(next() >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now().toString(36)}.${next()}@example.com`;

export interface ApiOpts {
  body?: unknown;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
  rawBody?: BodyInit;
}

export interface ApiResult<T = any> {
  status: number;
  data: T;
  cookie?: string;
  setCookie: string | null;
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
  const res = await handle(new Request(BASE + path, { method, headers, body }), env, (p) => pending.push(p));
  await Promise.all(pending);

  const setCookie = res.headers.get('set-cookie');
  const m = setCookie?.match(/spotter_session=([^;]*)/);
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.clone().json() : null;
  return { status: res.status, data: data as T, cookie: m?.[1] ? `spotter_session=${m[1]}` : undefined, setCookie, res };
}

const PASSWORD = 'correct horse battery';

/** Registers (or logs in) the configured super user and returns a cookie. */
export async function superCookie(email = 'boss@example.com'): Promise<string> {
  const reg = await api('POST', '/api/auth/register', { body: { email, password: PASSWORD, displayName: 'Boss' } });
  if (reg.cookie) return reg.cookie;
  const login = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  if (!login.cookie) throw new Error(`super login failed: ${login.status} ${JSON.stringify(login.data)}`);
  return login.cookie;
}

export async function createInvite(cookie: string, note?: string): Promise<{ id: string; token: string }> {
  const res = await api('POST', '/api/admin/invites', { cookie, body: { note } });
  if (res.status !== 201) throw new Error(`invite failed: ${res.status}`);
  return res.data;
}

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
  password: string;
}

/** Creates an invited, logged-in regular user. */
export async function newUser(name = 'Sam'): Promise<TestUser> {
  const boss = await superCookie();
  const { token } = await createInvite(boss);
  const email = uniqueEmail(name.toLowerCase());
  const res = await api('POST', '/api/auth/register', {
    body: { email, password: PASSWORD, displayName: name, inviteToken: token },
  });
  if (res.status !== 201 || !res.cookie) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { id: res.data.user.id, email, cookie: res.cookie, password: PASSWORD };
}

export { env, PASSWORD };
