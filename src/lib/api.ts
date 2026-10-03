// Tiny fetch wrapper for the JSON API. Same-origin, so the session cookie is
// sent automatically.
import { errors } from '../content/copy';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { redirectOn401?: boolean } = {}): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'offline', errors.offline);
  }
  if (res.status === 401 && opts.redirectOn401 !== false) {
    const next = location.pathname + location.search;
    location.href = `/login?next=${encodeURIComponent(next)}`;
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? errors.generic, e.details);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});
export const del = <T = any>(path: string) => api<T>('DELETE', path);

export interface Me {
  user: { id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string; units: 'metric' | 'imperial'; isSuper: boolean };
  pair: null | {
    id: string;
    type: 'couple' | 'friends';
    allowSelfEdit: boolean;
    togetherSince: string | null;
    createdAt: number;
    partner: { id: string; displayName: string };
  };
}

let mePromise: Promise<Me> | null = null;
/** The signed-in user, fetched once per page. Redirects to /login if signed out. */
export function getMe(): Promise<Me> {
  return (mePromise ??= get<Me>('/api/auth/me'));
}

/** Local calendar date as YYYY-MM-DD. */
export function today(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
