// Delivering Web Push notifications to a user's devices.
import { fromB64url } from '../crypto';
import type { Ctx, Env } from '../types';
import { encryptPayload } from './encrypt';
import { vapidAuthorization, vapidConfigured } from './vapid';

export type PushType = 'message' | 'nudge' | 'photo' | 'plan' | 'note' | 'milestone' | 'workout';

/** push_prefs column per type. A fixed map, never built from input. */
const PREF_COLUMN: Record<PushType, string> = {
  message: 'message',
  nudge: 'nudge',
  photo: 'photo',
  plan: 'plan',
  note: 'note',
  milestone: 'milestone',
  workout: 'workout',
};
export const PUSH_TYPES = Object.keys(PREF_COLUMN) as PushType[];

/** What the service worker shows. Never include weight or calorie numbers. */
export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap goes (same-origin path). */
  url: string;
  /** Collapses repeats of a type into one notification that updates. */
  tag: string;
  renotify?: boolean;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Push services we're willing to send to. The server POSTs to whatever
 * endpoint a browser registers, so anything else is refused.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function isAllowedPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export const pushConfigured = vapidConfigured;

/** Sends one notification. Returns the push service's HTTP status (0 on network error). */
export async function sendOne(env: Env, sub: PushSubscriptionRow, msg: PushMessage, now: number, urgency: 'normal' | 'high' = 'normal'): Promise<number> {
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(msg)), fromB64url(sub.p256dh), fromB64url(sub.auth));
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(env, sub.endpoint, now),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(24 * 3600),
        urgency,
      },
      body,
    });
    return res.status;
  } catch {
    return 0;
  }
}

/**
 * Sends to every subscription; prunes ones the push service says are gone
 * (404/410) and records successes. Returns how many were delivered.
 */
export async function deliver(env: Env, subs: PushSubscriptionRow[], msg: PushMessage, now: number, urgency: 'normal' | 'high' = 'normal'): Promise<number> {
  const statuses = await Promise.all(subs.map((s) => sendOne(env, s, msg, now, urgency).catch(() => 0)));
  const gone = subs.filter((_, i) => statuses[i] === 404 || statuses[i] === 410).map((s) => s.id);
  const ok = subs.filter((_, i) => statuses[i] >= 200 && statuses[i] < 300).map((s) => s.id);
  const db = env.DB;
  const stmts = [];
  if (gone.length) stmts.push(db.prepare('DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(gone)));
  if (ok.length) stmts.push(db.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(ok)));
  if (stmts.length) await db.batch(stmts);
  return ok.length;
}

/** A user's devices whose sessions are still valid. */
export function activeSubscriptionsSql(extraJoin = '', extraWhere = '') {
  return `SELECT s.id, s.endpoint, s.p256dh, s.auth${extraJoin ? ', p.hide_previews' : ''}
          FROM push_subscriptions s
          JOIN sessions se ON se.token_hash = s.session_hash AND se.expires_at > ?2
          ${extraJoin}
          WHERE s.user_id = ?1 ${extraWhere}`;
}

export interface NotifyOptions {
  urgency?: 'normal' | 'high';
  /** Checked inside waitUntil; return false to skip (e.g. already sent). */
  gate?: () => Promise<boolean>;
}

/**
 * Notifies the caller's partner (never the caller). Runs entirely inside
 * waitUntil: the triggering request isn't slowed, and a push failure is
 * logged, never surfaced.
 */
export function notifyPartner(c: Ctx, type: PushType, build: (o: { hidePreviews: boolean }) => PushMessage, opts: NotifyOptions = {}) {
  const partnerId = c.partnerId;
  if (!partnerId || partnerId === c.user.id || !pushConfigured(c.env)) return;
  const col = PREF_COLUMN[type];
  const env = c.env;
  const now = c.now;
  c.waitUntil(
    (async () => {
      try {
        if (opts.gate && !(await opts.gate())) return;
        // Devices whose sign-in has expired are removed, not just skipped.
        await env.DB.prepare(
          `DELETE FROM push_subscriptions WHERE user_id = ?1
             AND session_hash IN (SELECT token_hash FROM sessions WHERE user_id = ?1 AND expires_at <= ?2)`,
        )
          .bind(partnerId, now)
          .run();
        const { results } = await env.DB.prepare(
          activeSubscriptionsSql('JOIN push_prefs p ON p.user_id = s.user_id', `AND p.enabled = 1 AND p.${col} = 1`),
        )
          .bind(partnerId, now)
          .all<PushSubscriptionRow & { hide_previews: number }>();
        if (!results.length) return;
        await deliver(env, results, build({ hidePreviews: !!results[0].hide_previews }), now, opts.urgency);
      } catch (e) {
        console.error('push notify failed', type, e);
      }
    })(),
  );
}
