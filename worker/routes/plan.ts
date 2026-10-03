import { upsertActivity } from '../activity';
import { randomId } from '../crypto';
import { isoDate } from '../dates';
import { conflict, json, readJson } from '../http';
import type { Router } from '../router';
import type { Ctx } from '../types';
import { parse, v } from '../validate';

export const LOW_CALORIE_THRESHOLD = 1200;

const id = v.optional(v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9-]+$/ }));
const macro = v.optional(v.nullable(v.number({ min: 0, max: 1000, int: true })));

export const PlanBody = v.object({
  /** The version the editor started from; omit or 0 when no plan exists yet. */
  version: v.optional(v.number({ min: 0, int: true })),
  calorieTarget: v.optional(v.nullable(v.number({ min: 0, max: 10000, int: true }))),
  calorieGoal: v.enum(['deficit', 'surplus', 'maintain'] as const),
  proteinG: macro,
  carbsG: macro,
  fatG: macro,
  meals: v.array(
    v.object({
      id,
      name: v.string({ min: 1, max: 60 }),
      items: v.string({ max: 1000 }),
      notes: v.optional(v.string({ max: 500 })),
    }),
    { max: 12 },
  ),
  exercises: v.array(
    v.object({
      id,
      weekday: v.number({ min: 0, max: 6, int: true }),
      name: v.string({ min: 1, max: 80 }),
      equipment: v.optional(v.string({ max: 80 })),
      sets: v.optional(v.nullable(v.number({ min: 1, max: 50, int: true }))),
      reps: v.optional(v.string({ max: 20 })),
      targetWeightKg: v.optional(v.nullable(v.number({ min: 0, max: 1000 }))),
      notes: v.optional(v.string({ max: 500 })),
    }),
    { max: 120 },
  ),
});

export function planWarnings(calorieTarget: number | null | undefined): string[] {
  return calorieTarget != null && calorieTarget > 0 && calorieTarget < LOW_CALORIE_THRESHOLD ? ['calories_low'] : [];
}

/** Whether the caller may edit the subject's plan (mirrors resolveWho 'plan'). */
const canEdit = (c: Ctx) => !c.isSelf || !c.pair || !!c.pair.allow_self_edit;

export async function loadPlan(db: D1Database, userId: string) {
  const [plan, meals, exercises] = await db.batch([
    db.prepare(
      `SELECT p.calorie_target AS calorieTarget, p.calorie_goal AS calorieGoal, p.protein_g AS proteinG,
              p.carbs_g AS carbsG, p.fat_g AS fatG, p.version, p.updated_at AS updatedAt,
              p.updated_by AS updatedById, u.display_name AS updatedByName
       FROM plans p LEFT JOIN users u ON u.id = p.updated_by WHERE p.user_id = ?`,
    ).bind(userId),
    db.prepare('SELECT id, name, items, notes FROM plan_meals WHERE user_id = ? ORDER BY position').bind(userId),
    db.prepare(
      `SELECT id, weekday, name, equipment, sets, reps, target_weight_kg AS targetWeightKg, notes
       FROM plan_exercises WHERE user_id = ? ORDER BY weekday, position`,
    ).bind(userId),
  ]);
  const p = (plan.results[0] as Record<string, unknown> | undefined) ?? null;
  return { plan: p, meals: meals.results, exercises: exercises.results };
}

export function registerPlanRoutes(r: Router) {
  r.get('/api/u/:who/plan', { who: 'read' }, async (c) => {
    const data = await loadPlan(c.env.DB, c.subjectId);
    return json({
      ...data,
      canEdit: canEdit(c),
      warnings: planWarnings(data.plan?.calorieTarget as number | null),
    });
  });

  r.put('/api/u/:who/plan', { who: 'plan' }, async (c) => {
    const b = parse(PlanBody, await readJson(c.req));
    const db = c.env.DB;
    const userId = c.subjectId;

    // Optimistic concurrency: both partners could have the editor open.
    const current = await db.prepare('SELECT version FROM plans WHERE user_id = ?').bind(userId).first<{ version: number }>();
    const currentVersion = current?.version ?? 0;
    if (b.version !== undefined && b.version !== currentVersion) {
      throw conflict('This plan was changed while you were editing. Reload to see the latest version.');
    }

    const meals = b.meals.map((m, i) => ({ id: m.id ?? randomId(), position: i, name: m.name, items: m.items, notes: m.notes ?? '' }));
    const counters = new Map<number, number>();
    const exercises = b.exercises.map((e) => {
      const pos = counters.get(e.weekday) ?? 0;
      counters.set(e.weekday, pos + 1);
      return {
        id: e.id ?? randomId(),
        weekday: e.weekday,
        position: pos,
        name: e.name,
        equipment: e.equipment ?? '',
        sets: e.sets ?? null,
        reps: e.reps ?? '',
        targetWeightKg: e.targetWeightKg ?? null,
        notes: e.notes ?? '',
      };
    });
    const mealsJson = JSON.stringify(meals);
    const exJson = JSON.stringify(exercises);

    // A handful of set-based statements regardless of plan size, to stay well
    // under the free plan's per-invocation query limit. Upserts only touch
    // rows owned by this user, so a forged id can't hijack someone else's row.
    await db.batch([
      db
        .prepare(
          `INSERT INTO plans (user_id, calorie_target, calorie_goal, protein_g, carbs_g, fat_g, version, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)
           ON CONFLICT(user_id) DO UPDATE SET
             calorie_target = ?2, calorie_goal = ?3, protein_g = ?4, carbs_g = ?5, fat_g = ?6,
             version = version + 1, updated_by = ?7, updated_at = ?8`,
        )
        .bind(userId, b.calorieTarget ?? null, b.calorieGoal, b.proteinG ?? null, b.carbsG ?? null, b.fatG ?? null, c.user.id, c.now),
      db
        .prepare(`DELETE FROM plan_meals WHERE user_id = ?1 AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`)
        .bind(userId, mealsJson),
      db
        .prepare(
          `INSERT INTO plan_meals (id, user_id, position, name, items, notes)
           SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.position'), json_extract(value, '$.name'),
                  json_extract(value, '$.items'), json_extract(value, '$.notes')
           FROM json_each(?2) WHERE true
           ON CONFLICT(id) DO UPDATE SET position = excluded.position, name = excluded.name,
             items = excluded.items, notes = excluded.notes
           WHERE plan_meals.user_id = excluded.user_id`,
        )
        .bind(userId, mealsJson),
      db
        .prepare(`DELETE FROM plan_exercises WHERE user_id = ?1 AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`)
        .bind(userId, exJson),
      db
        .prepare(
          `INSERT INTO plan_exercises (id, user_id, weekday, position, name, equipment, sets, reps, target_weight_kg, notes)
           SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.weekday'), json_extract(value, '$.position'),
                  json_extract(value, '$.name'), json_extract(value, '$.equipment'), json_extract(value, '$.sets'),
                  json_extract(value, '$.reps'), json_extract(value, '$.targetWeightKg'), json_extract(value, '$.notes')
           FROM json_each(?2) WHERE true
           ON CONFLICT(id) DO UPDATE SET weekday = excluded.weekday, position = excluded.position, name = excluded.name,
             equipment = excluded.equipment, sets = excluded.sets, reps = excluded.reps,
             target_weight_kg = excluded.target_weight_kg, notes = excluded.notes
           WHERE plan_exercises.user_id = excluded.user_id`,
        )
        .bind(userId, exJson),
      upsertActivity(db, {
        userId: c.user.id,
        type: 'plan',
        refId: `${userId}:${isoDate(c.now)}`,
        date: isoDate(c.now),
        summary: { forSelf: c.isSelf },
        now: c.now,
      }),
    ]);

    return json({ version: currentVersion + 1, warnings: planWarnings(b.calorieTarget) });
  });
}
