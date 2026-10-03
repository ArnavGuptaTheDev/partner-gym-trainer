import { fromB64url, randomId } from '../crypto';
import { badRequest, HttpError, json, readJson } from '../http';
import { activeSubscriptionsSql, deliver, isAllowedPushEndpoint, PUSH_TYPES, pushConfigured, type PushSubscriptionRow } from '../push/send';
import { rateLimit } from '../ratelimit';
import type { Router } from '../router';
import { parse, v } from '../validate';

export const MAX_DEVICES_PER_USER = 10;

const b64urlStr = (max: number) => v.string({ min: 1, max, pattern: /^[A-Za-z0-9_-]+=*$/ });
const SubscribeBody = v.object({
  endpoint: v.string({ min: 10, max: 1000 }),
  keys: v.object({ p256dh: b64urlStr(200), auth: b64urlStr(64) }),
});
const UnsubscribeBody = v.object({ endpoint: v.string({ min: 1, max: 1000 }) });
const PrefsBody = v.object({
  enabled: v.optional(v.boolean()),
  message: v.optional(v.boolean()),
  nudge: v.optional(v.boolean()),
  photo: v.optional(v.boolean()),
  plan: v.optional(v.boolean()),
  note: v.optional(v.boolean()),
  milestone: v.optional(v.boolean()),
  workout: v.optional(v.boolean()),
  hidePreviews: v.optional(v.boolean()),
});

const PREF_COLUMNS = [...PUSH_TYPES, 'enabled', 'hide_previews'] as const;

function prefsView(row: Record<string, number> | null) {
  const on = (k: string, dflt: boolean) => (row ? !!row[k] : dflt);
  return {
    // No row means notifications were never turned on.
    enabled: on('enabled', false),
    types: Object.fromEntries(PUSH_TYPES.map((t) => [t, on(t, true)])),
    hidePreviews: on('hide_previews', false),
  };
}

/** Browser keys must decode to a P-256 point and a 16-byte secret. */
async function validKeys(p256dh: string, auth: string): Promise<boolean> {
  try {
    const pub = fromB64url(p256dh);
    if (pub.length !== 65 || pub[0] !== 0x04 || fromB64url(auth).length !== 16) return false;
    await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return true;
  } catch {
    return false;
  }
}

export function registerPushRoutes(r: Router) {
  r.get('/api/push/config', {}, async (c) => {
    const prefs = await c.env.DB.prepare('SELECT enabled FROM push_prefs WHERE user_id = ?').bind(c.user.id).first<{ enabled: number }>();
    return json({ publicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null, enabled: !!prefs?.enabled });
  });

  // Registers (or re-registers) this device. Called when notifications are
  // turned on and again on every app load, so the row follows the current
  // session and picks up rotated endpoints.
  r.post('/api/push/subscribe', {}, async (c) => {
    if (!pushConfigured(c.env)) throw new HttpError(503, 'push_unavailable', 'Notifications aren’t set up on this server.');
    const b = parse(SubscribeBody, await readJson(c.req));
    if (!isAllowedPushEndpoint(b.endpoint)) throw badRequest('endpoint: not a supported push service', { field: 'endpoint' });
    if (!(await validKeys(b.keys.p256dh, b.keys.auth))) throw badRequest('keys: invalid subscription keys', { field: 'keys' });

    const db = c.env.DB;
    const ua = (c.req.headers.get('user-agent') ?? '').slice(0, 200);
    await db.batch([
      db
        .prepare(
          `INSERT INTO push_subscriptions (id, user_id, session_hash, endpoint, p256dh, auth, user_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, session_hash = excluded.session_hash,
             p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
        )
        .bind(randomId(), c.user.id, c.sessionHash, b.endpoint, b.keys.p256dh, b.keys.auth, ua, c.now),
      // First device: settings start with everything on.
      db.prepare('INSERT OR IGNORE INTO push_prefs (user_id, updated_at) VALUES (?, ?)').bind(c.user.id, c.now),
      // Keep at most MAX_DEVICES_PER_USER, dropping the stalest.
      db
        .prepare(
          `DELETE FROM push_subscriptions WHERE user_id = ?1 AND id IN (
             SELECT id FROM push_subscriptions WHERE user_id = ?1
             ORDER BY COALESCE(last_success_at, created_at) DESC LIMIT -1 OFFSET ?2)`,
        )
        .bind(c.user.id, MAX_DEVICES_PER_USER),
    ]);
    return json({ ok: true });
  });

  r.post('/api/push/unsubscribe', {}, async (c) => {
    const { endpoint } = parse(UnsubscribeBody, await readJson(c.req));
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, c.user.id).run();
    return json({ ok: true });
  });

  // "Send me a test": the one notification that goes to yourself.
  r.post('/api/push/test', {}, async (c) => {
    await rateLimit(c, 'pushTest');
    if (!pushConfigured(c.env)) throw new HttpError(503, 'push_unavailable', 'Notifications aren’t set up on this server.');
    const { results } = await c.env.DB.prepare(activeSubscriptionsSql()).bind(c.user.id, c.now).all<PushSubscriptionRow>();
    const delivered = await deliver(
      c.env,
      results,
      { title: 'Spotter', body: 'Notifications are working 🎉', url: '/settings', tag: 'test' },
      c.now,
    );
    return json({ devices: results.length, delivered });
  });

  r.get('/api/push/prefs', {}, async (c) => {
    const row = await c.env.DB.prepare('SELECT * FROM push_prefs WHERE user_id = ?').bind(c.user.id).first<Record<string, number>>();
    return json(prefsView(row));
  });

  r.put('/api/push/prefs', {}, async (c) => {
    const b = parse(PrefsBody, await readJson(c.req)) as Record<string, boolean | undefined>;
    const cols = PREF_COLUMNS.filter((col) => b[col === 'hide_previews' ? 'hidePreviews' : col] !== undefined);
    const vals = cols.map((col) => (b[col === 'hide_previews' ? 'hidePreviews' : col] ? 1 : 0));
    const db = c.env.DB;
    // Column names come from the fixed PREF_COLUMNS list, never from input.
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO push_prefs (user_id, updated_at) VALUES (?, ?)').bind(c.user.id, c.now),
      ...(cols.length
        ? [db.prepare(`UPDATE push_prefs SET ${cols.map((col) => `${col} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`).bind(...vals, c.now, c.user.id)]
        : []),
    ]);
    const row = await db.prepare('SELECT * FROM push_prefs WHERE user_id = ?').bind(c.user.id).first<Record<string, number>>();
    return json(prefsView(row));
  });
}
