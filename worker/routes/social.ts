import { STREAK_TYPES, upsertActivity } from '../activity';
import { randomId } from '../crypto';
import { addDays, assertLogDate, weekdayOf } from '../dates';
import { HttpError, json, notFound, pageLimit, readJson } from '../http';
import { currentStreak, intersect, qualifyingMilestones, type MilestoneKind } from '../milestones';
import type { Router } from '../router';
import type { Ctx, Pair } from '../types';
import { parse, v } from '../validate';
import { unreadStmt } from './chat';

export const REACTION_EMOJI = ['🔥', '💪', '❤️', '👏', '😍', '🤯'] as const;
export const NUDGE_COOLDOWN_MS = 10 * 60 * 1000;

const ReactBody = v.object({ activityId: v.number({ min: 1, int: true }), emoji: v.enum(REACTION_EMOJI) });
const NudgeBody = v.object({ kind: v.enum(['proud', 'gym'] as const) });
const NoteBody = v.object({ body: v.string({ max: 280 }) });

const streakTypes = STREAK_TYPES.map((t) => `'${t}'`).join(', ');

interface ActivityRow {
  id: number;
  user_id: string;
  date: string;
  type: string;
  summary: string;
  created_at: number;
}
interface ReactionRow {
  activity_id: number;
  emoji: string;
  from_user: string;
}

function activityViews(rows: ActivityRow[], reactions: ReactionRow[]) {
  const byActivity = new Map<number, { emoji: string; fromUserId: string }[]>();
  for (const r of reactions) {
    byActivity.set(r.activity_id, [...(byActivity.get(r.activity_id) ?? []), { emoji: r.emoji, fromUserId: r.from_user }]);
  }
  return rows.map((a) => ({
    id: a.id,
    userId: a.user_id,
    date: a.date,
    type: a.type,
    summary: JSON.parse(a.summary),
    createdAt: a.created_at,
    reactions: byActivity.get(a.id) ?? [],
  }));
}

function requirePair(c: Ctx): Pair {
  if (!c.pair) throw notFound('You are not paired.');
  return c.pair;
}

function unseenNudgesStmt(db: D1Database, userId: string, now: number) {
  return db
    .prepare(
      `SELECT n.id, n.kind, n.created_at AS createdAt, u.display_name AS fromName
       FROM nudges n JOIN users u ON u.id = n.from_user
       WHERE n.to_user = ? AND n.seen_at IS NULL AND n.created_at > ?
       ORDER BY n.created_at DESC LIMIT 5`,
    )
    .bind(userId, now - 3 * 86_400_000);
}

export function registerSocialRoutes(r: Router) {
  // Cheap, frequently polled status for the badge and nudge toasts.
  r.get('/api/pulse', {}, async (c) => {
    if (!c.pair) return json({ unread: 0, nudges: [] });
    const db = c.env.DB;
    const [unread, nudges] = await db.batch([unreadStmt(db, c.pair.id, c.user.id), unseenNudgesStmt(db, c.user.id, c.now)]);
    return json({ unread: (unread.results[0] as { n: number }).n, nudges: nudges.results });
  });

  // Activity feed for me or my partner, newest first, with reactions.
  r.get('/api/u/:who/feed', { who: 'read' }, async (c) => {
    const limit = pageLimit(c.url);
    const before = Number(c.url.searchParams.get('cursor')) || null;
    const db = c.env.DB;
    const page = `SELECT id FROM activities WHERE user_id = ?1 AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3`;
    const [acts, reacts] = await db.batch([
      db.prepare(`SELECT * FROM activities WHERE id IN (${page}) ORDER BY id DESC`).bind(c.subjectId, before, limit + 1),
      db.prepare(`SELECT activity_id, emoji, from_user FROM reactions WHERE activity_id IN (${page})`).bind(c.subjectId, before, limit + 1),
    ]);
    let rows = acts.results as ActivityRow[];
    const more = rows.length > limit;
    rows = rows.slice(0, limit);
    return json({ items: activityViews(rows, reacts.results as ReactionRow[]), nextCursor: more ? String(rows[rows.length - 1].id) : null });
  });

  r.post('/api/reactions', {}, async (c) => {
    const pair = requirePair(c);
    const b = parse(ReactBody, await readJson(c.req));
    const db = c.env.DB;
    // You can only react to your partner's activity.
    const res = await db
      .prepare(
        `INSERT INTO reactions (id, pair_id, from_user, activity_id, emoji, created_at)
         SELECT ?1, ?2, ?3, id, ?4, ?5 FROM activities WHERE id = ?6 AND user_id = ?7
         ON CONFLICT(from_user, activity_id, emoji) DO NOTHING`,
      )
      .bind(randomId(), pair.id, c.user.id, b.emoji, c.now, b.activityId, c.partnerId)
      .run();
    if (!res.meta.changes) {
      const exists = await db.prepare('SELECT 1 FROM activities WHERE id = ? AND user_id = ?').bind(b.activityId, c.partnerId).first();
      if (!exists) throw notFound();
    }
    return json({ ok: true }, { status: 201 });
  });

  r.delete('/api/reactions/:activityId/:emoji', {}, async (c) => {
    await c.env.DB.prepare('DELETE FROM reactions WHERE from_user = ? AND activity_id = ? AND emoji = ?')
      .bind(c.user.id, Number(c.params.activityId) || 0, c.params.emoji)
      .run();
    return json({ ok: true });
  });

  r.post('/api/nudges', {}, async (c) => {
    const pair = requirePair(c);
    const { kind } = parse(NudgeBody, await readJson(c.req));
    const db = c.env.DB;
    const recent = await db
      .prepare('SELECT 1 FROM nudges WHERE from_user = ? AND kind = ? AND created_at > ?')
      .bind(c.user.id, kind, c.now - NUDGE_COOLDOWN_MS)
      .first();
    if (recent) throw new HttpError(429, 'cooldown', 'Easy there! You can send that again in a few minutes.');
    await db
      .prepare('INSERT INTO nudges (id, pair_id, from_user, to_user, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(randomId(), pair.id, c.user.id, c.partnerId, kind, c.now)
      .run();
    return json({ ok: true }, { status: 201 });
  });

  r.post('/api/nudges/seen', {}, async (c) => {
    await c.env.DB.prepare('UPDATE nudges SET seen_at = ? WHERE to_user = ? AND seen_at IS NULL').bind(c.now, c.user.id).run();
    return json({ ok: true });
  });

  // Note of the day for the partner's home screen. Empty body clears it.
  r.put('/api/notes/:date', {}, async (c) => {
    const pair = requirePair(c);
    const date = assertLogDate(c.params.date, c.now);
    const { body } = parse(NoteBody, await readJson(c.req));
    const db = c.env.DB;
    if (!body) {
      await db.prepare('DELETE FROM day_notes WHERE to_user = ? AND date = ? AND pair_id = ?').bind(c.partnerId, date, pair.id).run();
    } else {
      await db
        .prepare(
          `INSERT INTO day_notes (pair_id, to_user, date, from_user, body, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(to_user, date) DO UPDATE SET body = excluded.body, from_user = excluded.from_user,
             pair_id = excluded.pair_id, created_at = excluded.created_at`,
        )
        .bind(pair.id, c.partnerId, date, c.user.id, body, c.now)
        .run();
    }
    return json({ ok: true });
  });

  r.post('/api/milestones/seen', {}, async (c) => {
    await c.env.DB.prepare('UPDATE milestones SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL').bind(c.now, c.user.id).run();
    return json({ ok: true });
  });

  // Everything the home screen needs in one batched round trip.
  r.get('/api/home', {}, async (c) => {
    const date = assertLogDate(c.url.searchParams.get('date') ?? '', c.now);
    const db = c.env.DB;
    const me = c.user.id;
    const partner = c.partnerId ?? '';
    const pairId = c.pair?.id ?? '';
    const since = addDays(date, -400);

    const [myDates, partnerDates, noteForMe, noteForPartner, todayActs, todayReacts, weight, milestones, nudges, plans, meals, planned, done, water] =
      await db.batch([
        db.prepare(`SELECT DISTINCT date FROM activities WHERE user_id = ? AND type IN (${streakTypes}) AND date >= ? ORDER BY date DESC`).bind(me, since),
        db.prepare(`SELECT DISTINCT date FROM activities WHERE user_id = ? AND type IN (${streakTypes}) AND date >= ? ORDER BY date DESC`).bind(partner, since),
        db.prepare(
          `SELECT n.body, u.display_name AS fromName FROM day_notes n JOIN users u ON u.id = n.from_user
           WHERE n.to_user = ? AND n.date = ? AND n.pair_id = ?`,
        ).bind(me, date, pairId),
        db.prepare('SELECT body FROM day_notes WHERE to_user = ? AND date = ? AND pair_id = ?').bind(partner, date, pairId),
        db.prepare('SELECT * FROM activities WHERE user_id IN (?1, ?2) AND date = ?3 ORDER BY id DESC LIMIT 40').bind(me, partner, date),
        db.prepare(
          `SELECT activity_id, emoji, from_user FROM reactions
           WHERE activity_id IN (SELECT id FROM activities WHERE user_id IN (?1, ?2) AND date = ?3)`,
        ).bind(me, partner, date),
        db.prepare(
          `SELECT p.start_weight_kg AS startKg, p.target_weight_kg AS targetKg,
                  (SELECT weight_kg FROM weight_logs WHERE user_id = ?1 ORDER BY date DESC LIMIT 1) AS currentKg
           FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?1`,
        ).bind(me),
        db.prepare('SELECT kind, achieved_at AS achievedAt, seen_at AS seenAt FROM milestones WHERE user_id = ?').bind(me),
        unseenNudgesStmt(db, me, c.now),
        db.prepare('SELECT user_id, calorie_target AS calorieTarget FROM plans WHERE user_id IN (?, ?)').bind(me, partner),
        db.prepare(
          'SELECT user_id, COALESCE(sum(calories), 0) AS kcal FROM meal_logs WHERE user_id IN (?, ?) AND date = ? GROUP BY user_id',
        ).bind(me, partner, date),
        db.prepare(
          `SELECT p.user_id, count(*) AS n FROM plan_exercises p
           WHERE p.user_id IN (?1, ?2)
             AND p.weekday = COALESCE((SELECT same_as FROM plan_days d WHERE d.user_id = p.user_id AND d.weekday = ?3), ?3)
           GROUP BY p.user_id`,
        ).bind(
          me,
          partner,
          weekdayOf(date),
        ),
        db.prepare(
          `SELECT user_id, sum(done) AS n FROM exercise_logs
           WHERE user_id IN (?, ?) AND date = ? AND plan_exercise_id IS NOT NULL GROUP BY user_id`,
        ).bind(me, partner, date),
        db.prepare('SELECT user_id, water_ml AS waterMl FROM day_logs WHERE user_id IN (?, ?) AND date = ?').bind(me, partner, date),
      ]);

    const mine = (myDates.results as { date: string }[]).map((r) => r.date);
    const theirs = (partnerDates.results as { date: string }[]).map((r) => r.date);
    const myStreak = currentStreak(mine, date);
    const streaks = {
      me: myStreak,
      partner: c.pair ? currentStreak(theirs, date) : 0,
      shared: c.pair ? currentStreak(intersect(mine, theirs), date) : 0,
      bothLoggedToday: c.pair ? mine.includes(date) && theirs.includes(date) : false,
    };

    // Award milestones lazily, the first time Home sees them qualify.
    const have = new Map((milestones.results as { kind: MilestoneKind; achievedAt: number; seenAt: number | null }[]).map((m) => [m.kind, m]));
    const fresh = qualifyingMilestones(myStreak, weight.results[0] as { startKg: number | null; currentKg: number | null; targetKg: number | null }).filter(
      (k) => !have.has(k),
    );
    if (fresh.length) {
      await db.batch(
        fresh.flatMap((kind) => [
          db.prepare('INSERT OR IGNORE INTO milestones (user_id, kind, achieved_at) VALUES (?, ?, ?)').bind(me, kind, c.now),
          upsertActivity(db, { userId: me, type: 'milestone', refId: kind, date, summary: { kind }, now: c.now }),
        ]),
      );
      for (const kind of fresh) have.set(kind, { kind, achievedAt: c.now, seenAt: null });
    }

    const per = (res: D1Result, key: string) => {
      const m = new Map<string, number | null>();
      for (const row of res.results as Record<string, any>[]) m.set(row.user_id, row[key]);
      return m;
    };
    const [targets, kcal, plannedN, doneN, waterMl] = [per(plans, 'calorieTarget'), per(meals, 'kcal'), per(planned, 'n'), per(done, 'n'), per(water, 'waterMl')];
    const todayFor = (id: string) => ({
      caloriesEaten: kcal.get(id) ?? 0,
      calorieTarget: targets.get(id) ?? null,
      exercisesPlanned: plannedN.get(id) ?? 0,
      exercisesDone: doneN.get(id) ?? 0,
      waterMl: waterMl.get(id) ?? 0,
    });

    const acts = activityViews(todayActs.results as ActivityRow[], todayReacts.results as ReactionRow[]);
    return json({
      date,
      streaks,
      noteForMe: noteForMe.results[0] ?? null,
      noteForPartner: (noteForPartner.results[0] as { body: string } | undefined)?.body ?? null,
      today: { me: todayFor(me), partner: c.pair ? todayFor(partner) : null },
      myActivity: acts.filter((a) => a.userId === me),
      partnerActivity: acts.filter((a) => a.userId === partner),
      newMilestones: [...have.values()].filter((m) => !m.seenAt).map(({ kind, achievedAt }) => ({ kind, achievedAt })),
      nudges: nudges.results,
    });
  });
}
