import { HttpError } from './http';
import type { Ctx } from './types';

/** How long IP-keyed counters may be kept. */
export const RATE_LIMIT_RETENTION_MS = 24 * 3600_000;

export const LIMITS = {
  oauthStart: { max: 30, windowMs: 15 * 60 * 1000 },
  oauthCallback: { max: 30, windowMs: 15 * 60 * 1000 },
  pairJoin: { max: 10, windowMs: 15 * 60 * 1000 },
  pushTest: { max: 5, windowMs: 15 * 60 * 1000 },
} as const;

/**
 * Fixed-window counter in D1, one statement per call. Throws 429 when the
 * caller (by IP) is over the limit for `bucket`.
 */
export async function rateLimit(c: Ctx, bucket: keyof typeof LIMITS): Promise<void> {
  const { max, windowMs } = LIMITS[bucket];
  const key = `${bucket}:${c.ip}`;
  const cutoff = c.now - windowMs;
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count, window_start`,
  )
    .bind(key, c.now, cutoff)
    .first<{ count: number; window_start: number }>();

  // Counters are keyed by IP address, so clear out any older than a day on
  // every counted request (the privacy policy relies on this). The table only
  // holds recent sign-in/pairing attempts, so this delete is tiny.
  c.waitUntil(c.env.DB.prepare('DELETE FROM rate_limits WHERE window_start <= ?').bind(c.now - RATE_LIMIT_RETENTION_MS).run());

  if (row && row.count > max) {
    const retry = Math.ceil((row.window_start + windowMs - c.now) / 1000);
    throw new HttpError(429, 'rate_limited', 'Too many attempts. Please wait a bit and try again.', { retryAfter: retry });
  }
}
