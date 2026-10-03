// Validation and SQL for writing a whole plan. Pure (no bindings) so the
// PUT route and the one-off import script run exactly the same statements.
import { EXERCISE_ICONS, formatReps, isExerciseIcon, MAX_EXERCISE_LINKS, MAX_EXERCISE_PHOTOS, safeHttpUrl } from '../shared/plan';
import { badRequest } from './http';
import { v, type Infer } from './validate';

const id = v.optional(v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9-]+$/ }));
const macro = v.optional(v.nullable(v.number({ min: 0, max: 1000, int: true })));
const reps = v.optional(v.nullable(v.number({ min: 0, max: 1000, int: true })));
const weekday = v.number({ min: 0, max: 6, int: true });

export const PlanBody = v.object({
  /** The version the editor started from; omit or 0 when no plan exists yet. */
  version: v.optional(v.number({ min: 0, int: true })),
  title: v.optional(v.string({ max: 60 })),
  tagline: v.optional(v.string({ max: 140 })),
  calorieTarget: v.optional(v.nullable(v.number({ min: 0, max: 10000, int: true }))),
  calorieGoal: v.enum(['deficit', 'surplus', 'maintain'] as const),
  dietTitle: v.optional(v.string({ max: 60 })),
  dietIntro: v.optional(v.string({ max: 300 })),
  dietTips: v.optional(v.string({ max: 2000 })),
  stock: v.optional(
    v.array(v.object({ emoji: v.optional(v.string({ max: 16 })), label: v.string({ min: 1, max: 40 }) }), { max: 40 }),
  ),
  proteinG: macro,
  carbsG: macro,
  fatG: macro,
  days: v.optional(
    v.array(
      v.object({
        weekday,
        title: v.optional(v.string({ max: 60 })),
        note: v.optional(v.string({ max: 500 })),
        isRest: v.optional(v.boolean()),
        restMessage: v.optional(v.string({ max: 1000 })),
        sameAs: v.optional(v.nullable(weekday)),
      }),
      { max: 7 },
    ),
  ),
  meals: v.array(
    v.object({
      id,
      /** Time slot, e.g. "Early morning". */
      timeLabel: v.optional(v.string({ max: 30 })),
      /** Heading, e.g. "Wake up". */
      name: v.string({ min: 1, max: 60 }),
      /** Structured items; each may list alternatives ("OR 3-4 boiled eggs"). */
      itemList: v.optional(
        v.array(
          v.object({ text: v.string({ min: 1, max: 200 }), or: v.optional(v.array(v.string({ min: 1, max: 200 }), { max: 4 })) }),
          { max: 20 },
        ),
      ),
      /** Free text, used only when itemList is absent (older clients). */
      items: v.optional(v.string({ max: 1000 })),
      notes: v.optional(v.string({ max: 500 })),
    }),
    { max: 12 },
  ),
  exercises: v.array(
    v.object({
      id,
      weekday,
      name: v.string({ min: 1, max: 80 }),
      altName: v.optional(v.string({ max: 80 })),
      muscles: v.optional(v.string({ max: 120 })),
      notes: v.optional(v.string({ max: 500 })),
      equipment: v.optional(v.string({ max: 80 })),
      sets: v.optional(v.nullable(v.number({ min: 1, max: 50, int: true }))),
      repsMin: reps,
      repsMax: reps,
      repsSuffix: v.optional(v.string({ max: 20 })),
      /** Free-text reps, only used when repsMin is absent (older clients). */
      reps: v.optional(v.string({ max: 20 })),
      targetWeightKg: v.optional(v.nullable(v.number({ min: 0, max: 1000 }))),
      icon: v.optional(v.nullable(v.enum(EXERCISE_ICONS))),
      links: v.optional(v.array(v.string({ min: 1, max: 500 }), { max: MAX_EXERCISE_LINKS })),
      mediaIds: v.optional(v.array(v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9-]+$/ }), { max: MAX_EXERCISE_PHOTOS })),
    }),
    { max: 120 },
  ),
});
export type PlanInput = Infer<typeof PlanBody>;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Cross-field rules the schema can't express. Throws 400 with a readable reason. */
export function checkPlanRules(b: PlanInput) {
  const days = new Map<number, NonNullable<PlanInput['days']>[number]>();
  for (const d of b.days ?? []) {
    if (days.has(d.weekday)) throw badRequest(`days: ${DAY_NAMES[d.weekday]} is listed twice`, { field: 'days' });
    days.set(d.weekday, d);
  }
  for (const d of days.values()) {
    if (d.sameAs == null) continue;
    if (d.isRest) throw badRequest(`days: ${DAY_NAMES[d.weekday]} can't be both a rest day and the same as another day`, { field: 'days' });
    if (d.sameAs === d.weekday) throw badRequest(`days: ${DAY_NAMES[d.weekday]} can't be the same as itself`, { field: 'days' });
    const target = days.get(d.sameAs);
    if (target?.sameAs != null) {
      throw badRequest(`days: ${DAY_NAMES[d.weekday]} copies ${DAY_NAMES[d.sameAs]}, which copies another day. Point it at ${DAY_NAMES[target.sameAs]} instead.`, { field: 'days' });
    }
    if (target?.isRest) throw badRequest(`days: ${DAY_NAMES[d.weekday]} can't copy ${DAY_NAMES[d.sameAs]}, a rest day`, { field: 'days' });
  }

  const seenMedia = new Set<string>();
  b.exercises.forEach((e, i) => {
    const day = days.get(e.weekday);
    if (day?.sameAs != null) {
      throw badRequest(`exercises[${i}]: ${DAY_NAMES[e.weekday]} uses ${DAY_NAMES[day.sameAs]}'s list; add exercises to ${DAY_NAMES[day.sameAs]} instead`, { field: `exercises[${i}].weekday` });
    }
    if (day?.isRest) throw badRequest(`exercises[${i}]: ${DAY_NAMES[e.weekday]} is a rest day`, { field: `exercises[${i}].weekday` });
    if (e.repsMin != null && e.repsMax != null && e.repsMax < e.repsMin) {
      throw badRequest(`exercises[${i}].repsMax: must be at least the minimum`, { field: `exercises[${i}].repsMax` });
    }
    for (const [j, link] of (e.links ?? []).entries()) {
      if (!safeHttpUrl(link)) throw badRequest(`exercises[${i}].links[${j}]: must be an http or https link`, { field: `exercises[${i}].links[${j}]` });
    }
    for (const m of e.mediaIds ?? []) {
      if (seenMedia.has(m)) throw badRequest(`exercises[${i}].mediaIds: a photo can only belong to one exercise`, { field: `exercises[${i}].mediaIds` });
      seenMedia.add(m);
    }
    if (e.icon != null && !isExerciseIcon(e.icon)) throw badRequest(`exercises[${i}].icon: unknown icon`);
  });
}

export interface MealItem {
  text: string;
  or: string[];
}

/** "Oats" + "OR 3-4 boiled eggs" on separate lines: the free-text form of a list. */
export const flattenItems = (list: MealItem[]) => list.map((it) => [it.text, ...it.or.map((o) => `OR ${o}`)].join('\n')).join('\n');

/** Item list for a meal row: structured if saved that way, else one item per line. */
export function mealItems(itemsJson: string | null, items: string): MealItem[] {
  if (itemsJson) {
    try {
      return JSON.parse(itemsJson);
    } catch {
      /* fall through to text */
    }
  }
  return items
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ text, or: [] }));
}

export const mediaIdsOf = (b: PlanInput) => b.exercises.flatMap((e) => e.mediaIds ?? []);

export interface Stmt {
  sql: string;
  params: unknown[];
}

/**
 * Statements that replace `userId`'s plan with `b`, in order. A constant
 * number regardless of plan size (json_each bulk upserts), well under the
 * free plan's per-invocation query limit. Upserts only touch rows owned by
 * this user, so a forged id can't hijack someone else's row.
 *
 * `deleteMediaIds` are media rows to remove (their R2 objects are the
 * caller's job); kept media ids are attached to their exercises.
 */
export function planWriteStatements(opts: {
  userId: string;
  editorId: string;
  body: PlanInput;
  now: number;
  newId: () => string;
  deleteMediaIds?: string[];
}): Stmt[] {
  const { userId, editorId, body: b, now, newId } = opts;

  const meals = b.meals.map((m, i) => {
    const list = m.itemList?.map((it) => ({ text: it.text, or: it.or ?? [] }));
    return {
      id: m.id ?? newId(),
      position: i,
      timeLabel: m.timeLabel ?? '',
      name: m.name,
      // A flattened copy keeps the free-text column meaningful (e.g. logged meals).
      items: list ? flattenItems(list) : (m.items ?? ''),
      itemsJson: list ? JSON.stringify(list) : null,
      notes: m.notes ?? '',
    };
  });
  const stock = (b.stock ?? []).map((x) => ({ emoji: x.emoji?.trim() ?? '', label: x.label }));
  const counters = new Map<number, number>();
  const media: { id: string; ex: string; pos: number }[] = [];
  const exercises = b.exercises.map((e) => {
    const pos = counters.get(e.weekday) ?? 0;
    counters.set(e.weekday, pos + 1);
    const exId = e.id ?? newId();
    (e.mediaIds ?? []).forEach((m, k) => media.push({ id: m, ex: exId, pos: k }));
    const structured = e.repsMin != null;
    return {
      id: exId,
      weekday: e.weekday,
      position: pos,
      name: e.name,
      altName: e.altName ?? '',
      muscles: e.muscles ?? '',
      notes: e.notes ?? '',
      equipment: e.equipment ?? '',
      sets: e.sets ?? null,
      repsMin: structured ? e.repsMin : null,
      repsMax: structured ? (e.repsMax ?? null) : null,
      repsSuffix: e.repsSuffix ?? '',
      // Legacy text column stays meaningful for older readers.
      reps: structured ? formatReps(e.repsMin, e.repsMax, e.repsSuffix) : (e.reps ?? ''),
      targetWeightKg: e.targetWeightKg ?? null,
      icon: e.icon ?? null,
      linksJson: JSON.stringify((e.links ?? []).map((l) => safeHttpUrl(l)!)),
    };
  });
  const days = (b.days ?? []).map((d) => ({
    weekday: d.weekday,
    title: d.title ?? '',
    note: d.note ?? '',
    isRest: d.isRest ? 1 : 0,
    restMessage: d.restMessage ?? '',
    sameAs: d.sameAs ?? null,
  }));
  const J = JSON.stringify;
  const today = new Date(now).toISOString().slice(0, 10);

  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO plans (user_id, calorie_target, calorie_goal, protein_g, carbs_g, fat_g, title, tagline,
                               diet_title, diet_intro, diet_tips, stock_json, version, updated_by, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?11, ?12, ?13, ?14, 1, ?9, ?10)
            ON CONFLICT(user_id) DO UPDATE SET
              calorie_target = ?2, calorie_goal = ?3, protein_g = ?4, carbs_g = ?5, fat_g = ?6, title = ?7, tagline = ?8,
              diet_title = ?11, diet_intro = ?12, diet_tips = ?13, stock_json = ?14,
              version = version + 1, updated_by = ?9, updated_at = ?10`,
      params: [
        userId, b.calorieTarget ?? null, b.calorieGoal, b.proteinG ?? null, b.carbsG ?? null, b.fatG ?? null, b.title ?? '', b.tagline ?? '',
        editorId, now, b.dietTitle ?? '', b.dietIntro ?? '', b.dietTips ?? '', J(stock),
      ],
    },
    { sql: 'DELETE FROM plan_days WHERE user_id = ?1', params: [userId] },
    {
      sql: `INSERT INTO plan_days (user_id, weekday, title, note, is_rest, rest_message, same_as)
            SELECT ?1, json_extract(value, '$.weekday'), json_extract(value, '$.title'), json_extract(value, '$.note'),
                   json_extract(value, '$.isRest'), json_extract(value, '$.restMessage'), json_extract(value, '$.sameAs')
            FROM json_each(?2)`,
      params: [userId, J(days)],
    },
    {
      sql: `DELETE FROM plan_meals WHERE user_id = ?1 AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
      params: [userId, J(meals)],
    },
    {
      sql: `INSERT INTO plan_meals (id, user_id, position, time_label, name, items, items_json, notes)
            SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.position'), json_extract(value, '$.timeLabel'),
                   json_extract(value, '$.name'), json_extract(value, '$.items'), json_extract(value, '$.itemsJson'),
                   json_extract(value, '$.notes')
            FROM json_each(?2) WHERE true
            ON CONFLICT(id) DO UPDATE SET position = excluded.position, time_label = excluded.time_label, name = excluded.name,
              items = excluded.items, items_json = excluded.items_json, notes = excluded.notes
            WHERE plan_meals.user_id = excluded.user_id`,
      params: [userId, J(meals)],
    },
  ];
  if (opts.deleteMediaIds?.length) {
    stmts.push({
      sql: `DELETE FROM plan_media WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
      params: [userId, J(opts.deleteMediaIds)],
    });
  }
  stmts.push(
    {
      sql: `DELETE FROM plan_exercises WHERE user_id = ?1 AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
      params: [userId, J(exercises)],
    },
    {
      sql: `INSERT INTO plan_exercises (id, user_id, weekday, position, name, alt_name, muscles, notes, equipment, sets,
                                        reps_min, reps_max, reps_suffix, reps, target_weight_kg, icon, links_json)
            SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.weekday'), json_extract(value, '$.position'),
                   json_extract(value, '$.name'), json_extract(value, '$.altName'), json_extract(value, '$.muscles'),
                   json_extract(value, '$.notes'), json_extract(value, '$.equipment'), json_extract(value, '$.sets'),
                   json_extract(value, '$.repsMin'), json_extract(value, '$.repsMax'), json_extract(value, '$.repsSuffix'),
                   json_extract(value, '$.reps'), json_extract(value, '$.targetWeightKg'), json_extract(value, '$.icon'),
                   json_extract(value, '$.linksJson')
            FROM json_each(?2) WHERE true
            ON CONFLICT(id) DO UPDATE SET weekday = excluded.weekday, position = excluded.position, name = excluded.name,
              alt_name = excluded.alt_name, muscles = excluded.muscles, notes = excluded.notes, equipment = excluded.equipment,
              sets = excluded.sets, reps_min = excluded.reps_min, reps_max = excluded.reps_max, reps_suffix = excluded.reps_suffix,
              reps = excluded.reps, target_weight_kg = excluded.target_weight_kg, icon = excluded.icon, links_json = excluded.links_json
            WHERE plan_exercises.user_id = excluded.user_id`,
      params: [userId, J(exercises)],
    },
  );
  if (media.length) {
    // Runs after the exercise upsert so the foreign keys exist.
    stmts.push({
      sql: `UPDATE plan_media SET
              plan_exercise_id = (SELECT json_extract(value, '$.ex') FROM json_each(?2) WHERE json_extract(value, '$.id') = plan_media.id),
              position = (SELECT json_extract(value, '$.pos') FROM json_each(?2) WHERE json_extract(value, '$.id') = plan_media.id)
            WHERE user_id = ?1 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`,
      params: [userId, J(media)],
    });
  }
  stmts.push({
    sql: `INSERT INTO activities (user_id, date, type, ref_id, summary, created_at) VALUES (?1, ?2, 'plan', ?3, ?4, ?5)
          ON CONFLICT(user_id, type, ref_id) DO UPDATE SET date = excluded.date, summary = excluded.summary, created_at = excluded.created_at`,
    params: [editorId, today, `${userId}:${today}`, J({ forSelf: editorId === userId }), now],
  });
  return stmts;
}
