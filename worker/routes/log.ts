import { randomId } from '../crypto';
import { addDays, assertLogDate, weekdayOf } from '../dates';
import { badRequest, conflict, json, notFound, readJson } from '../http';
import type { Router } from '../router';
import type { Ctx } from '../types';
import { parse, v } from '../validate';
import { dayView, exerciseView } from './plan';
import { weightStatements } from './profile';

export const DEFAULT_WATER_TARGET_ML = 2500;
const MAX_RANGE_DAYS = 62;

const PatchDay = v.object({
  caloriesBurned: v.optional(v.nullable(v.number({ min: 0, max: 10000, int: true }))),
  waterMl: v.optional(v.nullable(v.number({ min: 0, max: 15000, int: true }))),
  weightKg: v.optional(v.number({ min: 20, max: 400 })),
});

const exerciseFields = {
  sets: v.optional(v.nullable(v.number({ min: 0, max: 50, int: true }))),
  reps: v.optional(v.string({ max: 40 })),
  weightKg: v.optional(v.nullable(v.number({ min: 0, max: 1000 }))),
  done: v.optional(v.boolean()),
  notes: v.optional(v.string({ max: 500 })),
};
const NewExercise = v.object({
  planExerciseId: v.optional(v.string({ max: 64 })),
  name: v.optional(v.string({ min: 1, max: 80 })),
  equipment: v.optional(v.string({ max: 80 })),
  ...exerciseFields,
});
const PatchExercise = v.object(exerciseFields);

const mealFields = {
  description: v.optional(v.string({ max: 1000 })),
  calories: v.optional(v.nullable(v.number({ min: 0, max: 10000, int: true }))),
  proteinG: v.optional(v.nullable(v.number({ min: 0, max: 1000, int: true }))),
  carbsG: v.optional(v.nullable(v.number({ min: 0, max: 1000, int: true }))),
  fatG: v.optional(v.nullable(v.number({ min: 0, max: 1000, int: true }))),
};
const NewMeal = v.object({
  planMealId: v.optional(v.string({ max: 64 })),
  name: v.optional(v.string({ min: 1, max: 60 })),
  ...mealFields,
});
const PatchMeal = v.object({ name: v.optional(v.string({ min: 1, max: 60 })), ...mealFields });

// Workouts and meals each roll up into one feed item per day, recomputed in
// SQL after every change so the feed reads "finished 4 exercises", not 4 rows.
function refreshWorkout(db: D1Database, userId: string, date: string, now: number) {
  return [
    db
      .prepare(
        `INSERT INTO activities (user_id, date, type, ref_id, summary, created_at)
         SELECT ?1, ?2, 'workout', ?2,
                json_object('done', count(*), 'names', json((SELECT json_group_array(name) FROM
                  (SELECT name FROM exercise_logs WHERE user_id = ?1 AND date = ?2 AND done = 1 ORDER BY created_at LIMIT 4)))),
                ?3
         FROM exercise_logs WHERE user_id = ?1 AND date = ?2 AND done = 1
         HAVING count(*) > 0
         ON CONFLICT(user_id, type, ref_id) DO UPDATE SET summary = excluded.summary, created_at = excluded.created_at`,
      )
      .bind(userId, date, now),
    db
      .prepare(
        `DELETE FROM activities WHERE user_id = ?1 AND type = 'workout' AND ref_id = ?2
         AND NOT EXISTS (SELECT 1 FROM exercise_logs WHERE user_id = ?1 AND date = ?2 AND done = 1)`,
      )
      .bind(userId, date),
  ];
}

function refreshMeals(db: D1Database, userId: string, date: string, now: number) {
  return [
    db
      .prepare(
        `INSERT INTO activities (user_id, date, type, ref_id, summary, created_at)
         SELECT ?1, ?2, 'meal', ?2, json_object('count', count(*), 'calories', COALESCE(sum(calories), 0)), ?3
         FROM meal_logs WHERE user_id = ?1 AND date = ?2
         HAVING count(*) > 0
         ON CONFLICT(user_id, type, ref_id) DO UPDATE SET summary = excluded.summary, created_at = excluded.created_at`,
      )
      .bind(userId, date, now),
    db
      .prepare(
        `DELETE FROM activities WHERE user_id = ?1 AND type = 'meal' AND ref_id = ?2
         AND NOT EXISTS (SELECT 1 FROM meal_logs WHERE user_id = ?1 AND date = ?2)`,
      )
      .bind(userId, date),
  ];
}

const exerciseCols = `id, plan_exercise_id AS planExerciseId, name, equipment, sets, reps, weight_kg AS weightKg, done, notes`;
const mealCols = `id, plan_meal_id AS planMealId, name, description, calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG`;

async function loadDay(c: Ctx, date: string) {
  const db = c.env.DB;
  const uid = c.subjectId;
  const wd = weekdayOf(date);
  // A day marked "same as" another uses that day's exercise list.
  const effective = 'COALESCE((SELECT same_as FROM plan_days WHERE user_id = ?1 AND weekday = ?2), ?2)';
  const [plan, plannedEx, plannedMeals, exLogs, mealLogs, day, weight, planDays, media] = await db.batch([
    db.prepare(
      `SELECT calorie_target AS calorieTarget, calorie_goal AS calorieGoal, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG
       FROM plans WHERE user_id = ?`,
    ).bind(uid),
    db.prepare(`SELECT * FROM plan_exercises WHERE user_id = ?1 AND weekday = ${effective} ORDER BY position`).bind(uid, wd),
    db.prepare('SELECT id, name, items, notes FROM plan_meals WHERE user_id = ? ORDER BY position').bind(uid),
    db.prepare(`SELECT ${exerciseCols} FROM exercise_logs WHERE user_id = ? AND date = ? ORDER BY created_at`).bind(uid, date),
    db.prepare(`SELECT ${mealCols} FROM meal_logs WHERE user_id = ? AND date = ? ORDER BY created_at`).bind(uid, date),
    db.prepare('SELECT calories_burned AS caloriesBurned, water_ml AS waterMl FROM day_logs WHERE user_id = ? AND date = ?').bind(uid, date),
    db.prepare('SELECT weight_kg AS weightKg FROM weight_logs WHERE user_id = ? AND date = ?').bind(uid, date),
    db.prepare('SELECT * FROM plan_days WHERE user_id = ?').bind(uid),
    db.prepare(
      `SELECT id, plan_exercise_id, width, height FROM plan_media
       WHERE plan_exercise_id IN (SELECT id FROM plan_exercises WHERE user_id = ?1 AND weekday = ${effective}) ORDER BY position`,
    ).bind(uid, wd),
  ]);

  const exercises = (exLogs.results as Record<string, any>[]).map((e) => ({ ...e, done: !!e.done }) as Record<string, any>);
  const meals = mealLogs.results as Record<string, any>[];
  const planned = (plannedEx.results as any[]).map((e) => exerciseView(e, media.results as any[]));
  const days = new Map((planDays.results as Record<string, any>[]).map((d) => [d.weekday as number, dayView(d)]));
  const own = days.get(wd);
  const source = own?.sameAs != null ? days.get(own.sameAs) : undefined;
  const doneIds = new Set(exercises.filter((e) => e.done && e.planExerciseId).map((e) => e.planExerciseId));
  const sum = (k: string) => meals.reduce((s, m) => s + (m[k] ?? 0), 0);
  const dayRow = (day.results[0] as { caloriesBurned: number | null; waterMl: number | null } | undefined) ?? null;

  return {
    date,
    weekday: wd,
    plan: plan.results[0] ?? null,
    // Title/note fall back to the day this one copies.
    planDay: {
      title: own?.title || source?.title || '',
      note: own?.note || source?.note || '',
      isRest: own?.isRest ?? false,
      restMessage: own?.restMessage ?? '',
      sameAs: own?.sameAs ?? null,
    },
    plannedExercises: planned,
    plannedMeals: plannedMeals.results,
    exercises,
    meals,
    caloriesBurned: dayRow?.caloriesBurned ?? null,
    waterMl: dayRow?.waterMl ?? null,
    waterTargetMl: DEFAULT_WATER_TARGET_ML,
    weightKg: (weight.results[0] as { weightKg: number } | undefined)?.weightKg ?? null,
    totals: {
      caloriesEaten: sum('calories'),
      proteinG: sum('proteinG'),
      carbsG: sum('carbsG'),
      fatG: sum('fatG'),
      exercisesDone: exercises.filter((e) => e.done).length,
      plannedDone: planned.filter((p) => doneIds.has(p.id)).length,
      plannedTotal: planned.length,
    },
  };
}

export function registerLogRoutes(r: Router) {
  r.get('/api/u/:who/days/:date', { who: 'read' }, async (c) => {
    return json(await loadDay(c, assertLogDate(c.params.date, c.now)));
  });

  // Compact per-day summaries for calendars and charts. The range itself is
  // the page: at most 62 days per request.
  r.get('/api/u/:who/days', { who: 'read' }, async (c) => {
    const to = assertLogDate(c.url.searchParams.get('to') ?? '', c.now);
    const from = assertLogDate(c.url.searchParams.get('from') ?? '', c.now);
    if (from > to || addDays(from, MAX_RANGE_DAYS - 1) < to) throw badRequest(`Range must be 1–${MAX_RANGE_DAYS} days.`);
    const db = c.env.DB;
    const uid = c.subjectId;
    const [meals, ex, days, weights] = await db.batch([
      db.prepare(
        `SELECT date, count(*) AS meals, COALESCE(sum(calories), 0) AS caloriesEaten FROM meal_logs
         WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date`,
      ).bind(uid, from, to),
      db.prepare(
        `SELECT date, sum(done) AS exercisesDone FROM exercise_logs WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date`,
      ).bind(uid, from, to),
      db.prepare(
        `SELECT date, calories_burned AS caloriesBurned, water_ml AS waterMl FROM day_logs WHERE user_id = ? AND date BETWEEN ? AND ?`,
      ).bind(uid, from, to),
      db.prepare('SELECT date, weight_kg AS weightKg FROM weight_logs WHERE user_id = ? AND date BETWEEN ? AND ?').bind(uid, from, to),
    ]);
    const byDate = new Map<string, Record<string, unknown>>();
    for (const res of [meals, ex, days, weights]) {
      for (const row of res.results as { date: string }[]) byDate.set(row.date, { ...byDate.get(row.date), ...row });
    }
    const items = [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return json({ from, to, items });
  });

  r.patch('/api/u/:who/days/:date', { who: 'self' }, async (c) => {
    const date = assertLogDate(c.params.date, c.now);
    const b = parse(PatchDay, await readJson(c.req));
    const db = c.env.DB;
    const uid = c.user.id;
    const stmts: D1PreparedStatement[] = [];
    if ('caloriesBurned' in b || 'waterMl' in b) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO day_logs (user_id, date, calories_burned, water_ml, updated_at) VALUES (?1, ?2, ?3, ?5, ?7)
             ON CONFLICT(user_id, date) DO UPDATE SET
               calories_burned = CASE WHEN ?4 THEN ?3 ELSE calories_burned END,
               water_ml = CASE WHEN ?6 THEN ?5 ELSE water_ml END,
               updated_at = ?7`,
          )
          .bind(uid, date, b.caloriesBurned ?? null, 'caloriesBurned' in b ? 1 : 0, b.waterMl ?? null, 'waterMl' in b ? 1 : 0, c.now),
        db
          .prepare(
            `INSERT INTO activities (user_id, date, type, ref_id, summary, created_at)
             SELECT user_id, date, 'day', date, json_object('waterMl', water_ml, 'caloriesBurned', calories_burned), ?3
             FROM day_logs WHERE user_id = ?1 AND date = ?2 AND (water_ml > 0 OR calories_burned > 0)
             ON CONFLICT(user_id, type, ref_id) DO UPDATE SET summary = excluded.summary`,
          )
          .bind(uid, date, c.now),
        db
          .prepare(
            `DELETE FROM activities WHERE user_id = ?1 AND type = 'day' AND ref_id = ?2 AND NOT EXISTS
               (SELECT 1 FROM day_logs WHERE user_id = ?1 AND date = ?2 AND (water_ml > 0 OR calories_burned > 0))`,
          )
          .bind(uid, date),
      );
    }
    if (b.weightKg !== undefined) stmts.push(...weightStatements(db, uid, date, b.weightKg, c.now));
    if (stmts.length) await db.batch(stmts);
    return json(await loadDay(c, date));
  });

  r.post('/api/u/:who/days/:date/exercises', { who: 'self' }, async (c) => {
    const date = assertLogDate(c.params.date, c.now);
    const b = parse(NewExercise, await readJson(c.req));
    const db = c.env.DB;
    const uid = c.user.id;

    let name = b.name;
    let equipment = b.equipment ?? '';
    if (b.planExerciseId) {
      const planned = await db
        .prepare('SELECT name, equipment FROM plan_exercises WHERE id = ? AND user_id = ?')
        .bind(b.planExerciseId, uid)
        .first<{ name: string; equipment: string }>();
      if (!planned) throw notFound('That exercise isn’t in your plan.');
      name ??= planned.name;
      equipment = b.equipment ?? planned.equipment;
    }
    if (!name) throw badRequest('name: is required', { field: 'name' });

    const id = randomId();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO exercise_logs (id, user_id, date, plan_exercise_id, name, equipment, sets, reps, weight_kg, done, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, uid, date, b.planExerciseId ?? null, name, equipment, b.sets ?? null, b.reps ?? '', b.weightKg ?? null, b.done === false ? 0 : 1, b.notes ?? '', c.now),
        ...refreshWorkout(db, uid, date, c.now),
      ]);
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw conflict('Already logged today. Edit the existing entry instead.');
      throw e;
    }
    return json({ id }, { status: 201 });
  });

  r.patch('/api/u/:who/exercises/:id', { who: 'self' }, async (c) => {
    const b = parse(PatchExercise, await readJson(c.req));
    const db = c.env.DB;
    const row = await db.prepare('SELECT date FROM exercise_logs WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id).first<{ date: string }>();
    if (!row) throw notFound();
    const has = (k: string) => (k in b ? 1 : 0);
    await db.batch([
      db
        .prepare(
          `UPDATE exercise_logs SET
             sets = CASE WHEN ?2 THEN ?1 ELSE sets END,
             reps = CASE WHEN ?4 THEN ?3 ELSE reps END,
             weight_kg = CASE WHEN ?6 THEN ?5 ELSE weight_kg END,
             done = CASE WHEN ?8 THEN ?7 ELSE done END,
             notes = CASE WHEN ?10 THEN ?9 ELSE notes END
           WHERE id = ?11 AND user_id = ?12`,
        )
        .bind(
          b.sets ?? null, has('sets'),
          b.reps ?? '', has('reps'),
          b.weightKg ?? null, has('weightKg'),
          b.done ? 1 : 0, has('done'),
          b.notes ?? '', has('notes'),
          c.params.id, c.user.id,
        ),
      ...refreshWorkout(db, c.user.id, row.date, c.now),
    ]);
    return json({ ok: true });
  });

  r.delete('/api/u/:who/exercises/:id', { who: 'self' }, async (c) => {
    const db = c.env.DB;
    const row = await db.prepare('SELECT date FROM exercise_logs WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id).first<{ date: string }>();
    if (!row) throw notFound();
    await db.batch([
      db.prepare('DELETE FROM exercise_logs WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id),
      ...refreshWorkout(db, c.user.id, row.date, c.now),
    ]);
    return json({ ok: true });
  });

  r.post('/api/u/:who/days/:date/meals', { who: 'self' }, async (c) => {
    const date = assertLogDate(c.params.date, c.now);
    const b = parse(NewMeal, await readJson(c.req));
    const db = c.env.DB;
    const uid = c.user.id;
    let name = b.name;
    let description = b.description;
    if (b.planMealId) {
      const planned = await db.prepare('SELECT name, items FROM plan_meals WHERE id = ? AND user_id = ?').bind(b.planMealId, uid).first<{ name: string; items: string }>();
      if (!planned) throw notFound('That meal isn’t in your plan.');
      name ??= planned.name;
      description ??= planned.items;
    }
    if (!name) throw badRequest('name: is required', { field: 'name' });
    const id = randomId();
    await db.batch([
      db
        .prepare(
          `INSERT INTO meal_logs (id, user_id, date, plan_meal_id, name, description, calories, protein_g, carbs_g, fat_g, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, uid, date, b.planMealId ?? null, name, description ?? '', b.calories ?? null, b.proteinG ?? null, b.carbsG ?? null, b.fatG ?? null, c.now),
      ...refreshMeals(db, uid, date, c.now),
    ]);
    return json({ id }, { status: 201 });
  });

  r.patch('/api/u/:who/meals/:id', { who: 'self' }, async (c) => {
    const b = parse(PatchMeal, await readJson(c.req));
    const db = c.env.DB;
    const row = await db.prepare('SELECT date FROM meal_logs WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id).first<{ date: string }>();
    if (!row) throw notFound();
    const has = (k: string) => (k in b ? 1 : 0);
    await db.batch([
      db
        .prepare(
          `UPDATE meal_logs SET
             name = COALESCE(?1, name),
             description = CASE WHEN ?3 THEN ?2 ELSE description END,
             calories = CASE WHEN ?5 THEN ?4 ELSE calories END,
             protein_g = CASE WHEN ?7 THEN ?6 ELSE protein_g END,
             carbs_g = CASE WHEN ?9 THEN ?8 ELSE carbs_g END,
             fat_g = CASE WHEN ?11 THEN ?10 ELSE fat_g END
           WHERE id = ?12 AND user_id = ?13`,
        )
        .bind(
          b.name ?? null,
          b.description ?? '', has('description'),
          b.calories ?? null, has('calories'),
          b.proteinG ?? null, has('proteinG'),
          b.carbsG ?? null, has('carbsG'),
          b.fatG ?? null, has('fatG'),
          c.params.id, c.user.id,
        ),
      ...refreshMeals(db, c.user.id, row.date, c.now),
    ]);
    return json({ ok: true });
  });

  r.delete('/api/u/:who/meals/:id', { who: 'self' }, async (c) => {
    const db = c.env.DB;
    const row = await db.prepare('SELECT date FROM meal_logs WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id).first<{ date: string }>();
    if (!row) throw notFound();
    await db.batch([
      db.prepare('DELETE FROM meal_logs WHERE id = ? AND user_id = ?').bind(c.params.id, c.user.id),
      ...refreshMeals(db, c.user.id, row.date, c.now),
    ]);
    return json({ ok: true });
  });
}
