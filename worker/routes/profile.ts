import { removeActivity, upsertActivity } from '../activity';
import { assertLogDate } from '../dates';
import { json, notFound, pageLimit, readJson } from '../http';
import type { Router } from '../router';
import { parse, v } from '../validate';

const PatchProfile = v.object({
  displayName: v.optional(v.string({ min: 1, max: 40 })),
  timezone: v.optional(v.string({ min: 1, max: 64 })),
  units: v.optional(v.enum(['metric', 'imperial'] as const)),
  heightCm: v.optional(v.nullable(v.number({ min: 50, max: 260 }))),
  startWeightKg: v.optional(v.nullable(v.number({ min: 20, max: 400 }))),
  targetWeightKg: v.optional(v.nullable(v.number({ min: 20, max: 400 }))),
  goalMode: v.optional(v.nullable(v.enum(['lose', 'gain', 'maintain'] as const))),
  targetDate: v.optional(v.nullable(v.date())),
});

const PutWeight = v.object({ weightKg: v.number({ min: 20, max: 400 }) });

interface ProfileRow {
  display_name: string;
  units: string;
  timezone: string;
  height_cm: number | null;
  start_weight_kg: number | null;
  target_weight_kg: number | null;
  goal_mode: string | null;
  target_date: string | null;
  current_weight_kg: number | null;
  current_weight_date: string | null;
}

/** Statements that record a weigh-in (shared with the daily log). */
export function weightStatements(db: D1Database, userId: string, date: string, weightKg: number, now: number) {
  return [
    db
      .prepare(
        `INSERT INTO weight_logs (user_id, date, weight_kg, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`,
      )
      .bind(userId, date, weightKg, now),
    // The first weigh-in becomes the starting weight if none was set.
    db
      .prepare(
        `INSERT INTO profiles (user_id, start_weight_kg, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET start_weight_kg = COALESCE(start_weight_kg, ?2)`,
      )
      .bind(userId, weightKg, now),
    upsertActivity(db, { userId, type: 'weight', refId: date, date, summary: { weightKg }, now }),
  ];
}

export function registerProfileRoutes(r: Router) {
  r.get('/api/u/:who/profile', { who: 'read' }, async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT u.display_name, u.units, u.timezone,
              p.height_cm, p.start_weight_kg, p.target_weight_kg, p.goal_mode, p.target_date,
              w.weight_kg AS current_weight_kg, w.date AS current_weight_date
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN (SELECT weight_kg, date FROM weight_logs WHERE user_id = ?1 ORDER BY date DESC LIMIT 1) w
       WHERE u.id = ?1`,
    )
      .bind(c.subjectId)
      .first<ProfileRow>();
    if (!row) throw notFound();
    return json({
      displayName: row.display_name,
      units: row.units,
      timezone: row.timezone,
      heightCm: row.height_cm,
      startWeightKg: row.start_weight_kg,
      targetWeightKg: row.target_weight_kg,
      goalMode: row.goal_mode,
      targetDate: row.target_date,
      currentWeightKg: row.current_weight_kg,
      currentWeightDate: row.current_weight_date,
      isSelf: c.isSelf,
    });
  });

  r.patch('/api/u/:who/profile', { who: 'self' }, async (c) => {
    const b = parse(PatchProfile, await readJson(c.req));
    const db = c.env.DB;
    const has = (k: keyof typeof b) => (k in b ? 1 : 0);
    await db.batch([
      db
        .prepare(
          `UPDATE users SET display_name = COALESCE(?, display_name), timezone = COALESCE(?, timezone), units = COALESCE(?, units)
           WHERE id = ?`,
        )
        .bind(b.displayName ?? null, b.timezone ?? null, b.units ?? null, c.user.id),
      // Each column is only overwritten when the field was sent (null clears it).
      db
        .prepare(
          `INSERT INTO profiles (user_id, height_cm, start_weight_kg, target_weight_kg, goal_mode, target_date, updated_at)
           VALUES (?1, ?2, ?4, ?6, ?8, ?10, ?12)
           ON CONFLICT(user_id) DO UPDATE SET
             height_cm        = CASE WHEN ?3  THEN ?2  ELSE height_cm END,
             start_weight_kg  = CASE WHEN ?5  THEN ?4  ELSE start_weight_kg END,
             target_weight_kg = CASE WHEN ?7  THEN ?6  ELSE target_weight_kg END,
             goal_mode        = CASE WHEN ?9  THEN ?8  ELSE goal_mode END,
             target_date      = CASE WHEN ?11 THEN ?10 ELSE target_date END,
             updated_at = ?12`,
        )
        .bind(
          c.user.id,
          b.heightCm ?? null, has('heightCm'),
          b.startWeightKg ?? null, has('startWeightKg'),
          b.targetWeightKg ?? null, has('targetWeightKg'),
          b.goalMode ?? null, has('goalMode'),
          b.targetDate ?? null, has('targetDate'),
          c.now,
        ),
    ]);
    return json({ ok: true });
  });

  r.get('/api/u/:who/weights', { who: 'read' }, async (c) => {
    const limit = pageLimit(c.url, 60, 120);
    const before = c.url.searchParams.get('cursor');
    const { results } = await c.env.DB.prepare(
      `SELECT date, weight_kg AS weightKg FROM weight_logs
       WHERE user_id = ?1 AND (?2 IS NULL OR date < ?2)
       ORDER BY date DESC LIMIT ?3`,
    )
      .bind(c.subjectId, before, limit + 1)
      .all<{ date: string; weightKg: number }>();
    const more = results.length > limit;
    const items = more ? results.slice(0, limit) : results;
    return json({ items, nextCursor: more ? items[items.length - 1].date : null });
  });

  r.put('/api/u/:who/weights/:date', { who: 'self' }, async (c) => {
    const date = assertLogDate(c.params.date, c.now);
    const { weightKg } = parse(PutWeight, await readJson(c.req));
    await c.env.DB.batch(weightStatements(c.env.DB, c.user.id, date, weightKg, c.now));
    return json({ date, weightKg });
  });

  r.delete('/api/u/:who/weights/:date', { who: 'self' }, async (c) => {
    const date = assertLogDate(c.params.date, c.now);
    const db = c.env.DB;
    await db.batch([
      db.prepare('DELETE FROM weight_logs WHERE user_id = ? AND date = ?').bind(c.user.id, date),
      removeActivity(db, c.user.id, 'weight', date),
    ]);
    return json({ ok: true });
  });
}
