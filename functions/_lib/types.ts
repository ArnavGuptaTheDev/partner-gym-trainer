export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  SUPER_USER_EMAILS?: string;
  ALLOWED_ORIGINS?: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_active: number;
  timezone: string;
  units: 'metric' | 'imperial';
  created_at: number;
}

export interface Pair {
  id: string;
  user_a_id: string;
  user_b_id: string;
  pair_type: 'couple' | 'friends';
  allow_self_edit: number;
  together_since: string | null;
  created_at: number;
}

/** Per-request state, filled in by the middleware chain. */
export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  ip: string;
  now: number;
  waitUntil: (p: Promise<unknown>) => void;
  /** Set by the session middleware on authenticated routes. */
  user: User;
  isSuper: boolean;
  sessionHash: string;
  /** The caller's active pair, if any. */
  pair: Pair | null;
  partnerId: string | null;
  /** Set by the `who` middleware: the user whose data the route touches. */
  subjectId: string;
  isSelf: boolean;
}
