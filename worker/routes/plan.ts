import { randomId } from '../crypto';
import { badRequest, conflict, HttpError, json, notFound, readJson } from '../http';
import { checkPlanRules, mediaIdsOf, PlanBody, planWriteStatements } from '../planwrite';
import type { Router } from '../router';
import type { Ctx } from '../types';
import { extFor, intField, readImageUpload, streamImage } from '../upload';
import { parse } from '../validate';
import { canSeePhoto } from './photos';

export { PlanBody } from '../planwrite';
export const LOW_CALORIE_THRESHOLD = 1200;
export const MAX_PLAN_MEDIA_UPLOADS_PER_DAY = 20;
const DAY_MS = 86_400_000;

export function planWarnings(calorieTarget: number | null | undefined): string[] {
  return calorieTarget != null && calorieTarget > 0 && calorieTarget < LOW_CALORIE_THRESHOLD ? ['calories_low'] : [];
}

/** Whether the caller may edit the subject's plan (mirrors resolveWho 'plan'). */
const canEdit = (c: Ctx) => !c.isSelf || !c.pair || !!c.pair.allow_self_edit;

export const mediaUrl = (id: string) => `/api/plan-media/${id}`;

interface ExerciseRow {
  id: string;
  weekday: number;
  name: string;
  alt_name: string;
  muscles: string;
  notes: string;
  equipment: string;
  sets: number | null;
  reps: string;
  reps_min: number | null;
  reps_max: number | null;
  reps_suffix: string;
  target_weight_kg: number | null;
  icon: string | null;
  links_json: string;
}
interface MediaRow {
  id: string;
  plan_exercise_id: string;
  width: number | null;
  height: number | null;
}

/** Exercise shape returned to clients (plan view and the daily log). */
export function exerciseView(e: ExerciseRow, media: MediaRow[]) {
  let links: string[] = [];
  try {
    links = JSON.parse(e.links_json);
  } catch {
    /* keep empty */
  }
  return {
    id: e.id,
    weekday: e.weekday,
    name: e.name,
    altName: e.alt_name,
    muscles: e.muscles,
    notes: e.notes,
    equipment: e.equipment,
    sets: e.sets,
    repsMin: e.reps_min,
    repsMax: e.reps_max,
    repsSuffix: e.reps_suffix,
    reps: e.reps,
    targetWeightKg: e.target_weight_kg,
    icon: e.icon,
    links,
    media: media
      .filter((m) => m.plan_exercise_id === e.id)
      .map((m) => ({ id: m.id, url: mediaUrl(m.id), width: m.width, height: m.height })),
  };
}

export function dayView(d: Record<string, any>) {
  return { weekday: d.weekday, title: d.title, note: d.note, isRest: !!d.is_rest, restMessage: d.rest_message, sameAs: d.same_as };
}

export async function loadPlan(db: D1Database, userId: string) {
  const [plan, meals, exercises, days, media] = await db.batch([
    db.prepare(
      `SELECT p.calorie_target AS calorieTarget, p.calorie_goal AS calorieGoal, p.protein_g AS proteinG,
              p.carbs_g AS carbsG, p.fat_g AS fatG, p.title, p.tagline, p.version, p.updated_at AS updatedAt,
              p.updated_by AS updatedById, u.display_name AS updatedByName
       FROM plans p LEFT JOIN users u ON u.id = p.updated_by WHERE p.user_id = ?`,
    ).bind(userId),
    db.prepare('SELECT id, name, items, notes FROM plan_meals WHERE user_id = ? ORDER BY position').bind(userId),
    db.prepare('SELECT * FROM plan_exercises WHERE user_id = ? ORDER BY weekday, position').bind(userId),
    db.prepare('SELECT * FROM plan_days WHERE user_id = ? ORDER BY weekday').bind(userId),
    db.prepare(
      'SELECT id, plan_exercise_id, width, height FROM plan_media WHERE user_id = ? AND plan_exercise_id IS NOT NULL ORDER BY position',
    ).bind(userId),
  ]);
  const p = (plan.results[0] as Record<string, unknown> | undefined) ?? null;
  const m = media.results as MediaRow[];
  return {
    plan: p,
    days: (days.results as Record<string, any>[]).map(dayView),
    meals: meals.results,
    exercises: (exercises.results as ExerciseRow[]).map((e) => exerciseView(e, m)),
  };
}

/**
 * Lazy cleanup (no cron): unattached uploads older than a day are removed,
 * rows and R2 objects, whenever that plan gets an upload or a save.
 */
async function staleMedia(db: D1Database, userId: string, now: number) {
  const { results } = await db
    .prepare('SELECT id, r2_key FROM plan_media WHERE user_id = ? AND plan_exercise_id IS NULL AND created_at < ?')
    .bind(userId, now - DAY_MS)
    .all<{ id: string; r2_key: string }>();
  return results;
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
    checkPlanRules(b);
    const db = c.env.DB;
    const userId = c.subjectId;

    // Optimistic concurrency: both partners could have the editor open.
    const [current, mediaRows] = await db.batch([
      db.prepare('SELECT version FROM plans WHERE user_id = ?').bind(userId),
      db.prepare('SELECT id, r2_key, plan_exercise_id, created_at FROM plan_media WHERE user_id = ?').bind(userId),
    ]);
    const currentVersion = (current.results[0] as { version: number } | undefined)?.version ?? 0;
    if (b.version !== undefined && b.version !== currentVersion) {
      throw conflict('This plan was changed while you were editing. Reload to see the latest version.');
    }

    // Every referenced photo must already belong to this plan.
    const owned = new Map((mediaRows.results as { id: string; r2_key: string; plan_exercise_id: string | null; created_at: number }[]).map((m) => [m.id, m]));
    const keep = new Set(mediaIdsOf(b));
    for (const mid of keep) if (!owned.has(mid)) throw badRequest('mediaIds: a photo was not found; please re-upload it', { field: 'mediaIds' });
    // Removed from an exercise, or uploaded and abandoned over a day ago.
    const drop = [...owned.values()].filter((m) => !keep.has(m.id) && (m.plan_exercise_id !== null || m.created_at < c.now - DAY_MS));

    const stmts = planWriteStatements({ userId, editorId: c.user.id, body: b, now: c.now, newId: randomId, deleteMediaIds: drop.map((m) => m.id) });
    await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
    if (drop.length) await c.env.PHOTOS.delete(drop.map((m) => m.r2_key));

    return json({ version: currentVersion + 1, warnings: planWarnings(b.calorieTarget) });
  });

  // Exercise photo upload. Whoever may edit the plan may add photos to it.
  r.post('/api/u/:who/plan/media', { who: 'plan' }, async (c) => {
    const { bytes, mime, form } = await readImageUpload(c);
    const db = c.env.DB;
    const userId = c.subjectId;

    const [recent, stale] = await Promise.all([
      db.prepare('SELECT count(*) AS n FROM plan_media WHERE uploaded_by = ? AND created_at > ?').bind(c.user.id, c.now - DAY_MS).first<{ n: number }>(),
      staleMedia(db, userId, c.now),
    ]);
    if ((recent?.n ?? 0) >= MAX_PLAN_MEDIA_UPLOADS_PER_DAY) {
      throw new HttpError(429, 'upload_limit', `You can add up to ${MAX_PLAN_MEDIA_UPLOADS_PER_DAY} exercise photos a day. Try again tomorrow.`);
    }

    const id = randomId();
    const key = `plan/${userId}/${id}.${extFor(mime)}`;
    await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: mime } });
    const width = intField(form, 'width') ?? null;
    const height = intField(form, 'height') ?? null;
    const stmts = [
      db
        .prepare(
          `INSERT INTO plan_media (id, user_id, plan_exercise_id, position, r2_key, bytes, width, height, mime, uploaded_by, created_at)
           VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, key, bytes.byteLength, width, height, mime, c.user.id, c.now),
    ];
    if (stale.length) {
      stmts.push(db.prepare('DELETE FROM plan_media WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(stale.map((s) => s.id))));
    }
    try {
      await db.batch(stmts);
    } catch (e) {
      await c.env.PHOTOS.delete(key);
      throw e;
    }
    if (stale.length) await c.env.PHOTOS.delete(stale.map((s) => s.r2_key));
    return json({ id, url: mediaUrl(id), width, height }, { status: 201 });
  });

  // The only way exercise photo bytes leave R2: plan owner or their partner.
  r.get('/api/plan-media/:id', {}, async (c) => {
    const row = await c.env.DB.prepare('SELECT user_id, r2_key, mime FROM plan_media WHERE id = ?')
      .bind(c.params.id)
      .first<{ user_id: string; r2_key: string; mime: string }>();
    if (!row || !canSeePhoto(c, row.user_id)) throw notFound();
    return streamImage(c, c.params.id, row.r2_key, row.mime);
  });
}
