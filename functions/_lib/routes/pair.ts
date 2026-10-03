import { pairingCode, randomId } from '../crypto';
import { conflict, HttpError, json, notFound, readJson } from '../http';
import { rateLimit } from '../ratelimit';
import type { Router } from '../router';
import type { Ctx } from '../types';
import { parse, v } from '../validate';

export const PAIR_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const PAIR_TYPES = ['couple', 'friends'] as const;

const CreateCode = v.object({ pairType: v.enum(PAIR_TYPES) });
const JoinBody = v.object({ code: v.string({ min: 4, max: 20 }) });
const PatchPair = v.object({
  pairType: v.optional(v.enum(PAIR_TYPES)),
  allowSelfEdit: v.optional(v.boolean()),
  togetherSince: v.optional(v.nullable(v.date())),
});

const alreadyPaired = () => conflict('You already have a partner. Unpair first.');

/** Public shape of the caller's pair, used by /api/pair and /api/auth/me. */
export function pairView(c: Ctx) {
  if (!c.pair) return null;
  return {
    id: c.pair.id,
    type: c.pair.pair_type,
    allowSelfEdit: !!c.pair.allow_self_edit,
    togetherSince: c.pair.together_since,
    createdAt: c.pair.created_at,
    partner: { id: c.partnerId!, displayName: c.partnerName! },
  };
}

const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function registerPairRoutes(r: Router) {
  r.get('/api/pair', {}, async (c) => {
    let code = null;
    if (!c.pair) {
      code = await c.env.DB.prepare(
        'SELECT code, pair_type AS pairType, expires_at AS expiresAt FROM pairing_codes WHERE user_id = ? AND expires_at > ?',
      )
        .bind(c.user.id, c.now)
        .first();
    }
    return json({ pair: pairView(c), code });
  });

  r.post('/api/pair/code', {}, async (c) => {
    if (c.pair) throw alreadyPaired();
    const body = parse(CreateCode, await readJson(c.req));
    const expiresAt = c.now + PAIR_CODE_TTL_MS;
    // A user holds at most one code; generating a new one replaces it.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = pairingCode();
      try {
        await c.env.DB.prepare(
          `INSERT INTO pairing_codes (code, user_id, pair_type, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(user_id) DO UPDATE SET code = ?1, pair_type = ?3, created_at = ?4, expires_at = ?5`,
        )
          .bind(code, c.user.id, body.pairType, c.now, expiresAt)
          .run();
        return json({ code, pairType: body.pairType, expiresAt }, { status: 201 });
      } catch (e) {
        if (!String(e).includes('UNIQUE')) throw e; // code collision: retry
      }
    }
    throw new HttpError(503, 'try_again', 'Could not generate a code. Please try again.');
  });

  r.delete('/api/pair/code', {}, async (c) => {
    await c.env.DB.prepare('DELETE FROM pairing_codes WHERE user_id = ?').bind(c.user.id).run();
    return json({ ok: true });
  });

  r.post('/api/pair/join', {}, async (c) => {
    await rateLimit(c, 'pairJoin');
    if (c.pair) throw alreadyPaired();
    const { code } = parse(JoinBody, await readJson(c.req));
    const db = c.env.DB;

    const row = await db
      .prepare(
        `SELECT pc.user_id, pc.pair_type, u.is_active,
                EXISTS (SELECT 1 FROM pairs WHERE user_a_id = pc.user_id OR user_b_id = pc.user_id) AS owner_paired
         FROM pairing_codes pc JOIN users u ON u.id = pc.user_id
         WHERE pc.code = ? AND pc.expires_at > ?`,
      )
      .bind(normalizeCode(code), c.now)
      .first<{ user_id: string; pair_type: 'couple' | 'friends'; is_active: number; owner_paired: number }>();

    if (!row || !row.is_active) throw notFound('That code doesn’t exist or has expired.');
    if (row.user_id === c.user.id) throw conflict('That’s your own code. Send it to your partner instead.');
    if (row.owner_paired) throw conflict('That person already has a partner.');

    const pairId = randomId();
    try {
      await db.batch([
        db
          .prepare('INSERT INTO pairs (id, user_a_id, user_b_id, pair_type, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(pairId, row.user_id, c.user.id, row.pair_type, c.now),
        db.prepare('DELETE FROM pairing_codes WHERE user_id IN (?, ?)').bind(row.user_id, c.user.id),
      ]);
    } catch (e) {
      // The trigger/UNIQUE constraints catch races the checks above missed.
      if (/already_paired|UNIQUE/.test(String(e))) throw conflict('One of you is already paired.');
      throw e;
    }
    return json({ pairId, pairType: row.pair_type }, { status: 201 });
  });

  r.patch('/api/pair', {}, async (c) => {
    if (!c.pair) throw notFound('You are not paired.');
    const body = parse(PatchPair, await readJson(c.req));
    await c.env.DB.prepare(
      `UPDATE pairs SET
         pair_type = COALESCE(?1, pair_type),
         allow_self_edit = COALESCE(?2, allow_self_edit),
         together_since = CASE WHEN ?3 THEN ?4 ELSE together_since END
       WHERE id = ?5`,
    )
      .bind(
        body.pairType ?? null,
        body.allowSelfEdit === undefined ? null : body.allowSelfEdit ? 1 : 0,
        'togetherSince' in body ? 1 : 0,
        body.togetherSince ?? null,
        c.pair.id,
      )
      .run();
    return json({ ok: true });
  });

  r.delete('/api/pair', {}, async (c) => {
    if (!c.pair) throw notFound('You are not paired.');
    // Shared data (chat, reactions, notes) cascades away with the pair;
    // each person's own logs and photos are untouched.
    await c.env.DB.prepare('DELETE FROM pairs WHERE id = ?').bind(c.pair.id).run();
    return json({ ok: true });
  });
}
