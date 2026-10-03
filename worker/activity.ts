// Feed/streak bookkeeping. These return prepared statements so callers can
// include them in the same D1 batch as the write they describe.

export type ActivityType = 'workout' | 'meal' | 'photo' | 'weight' | 'day' | 'plan' | 'milestone';

/** Activity types that count as "logged today" for streaks. */
export const STREAK_TYPES: ActivityType[] = ['workout', 'meal', 'photo', 'weight', 'day'];

export function upsertActivity(
  db: D1Database,
  a: { userId: string; type: ActivityType; refId: string; date: string; summary: Record<string, unknown>; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activities (user_id, date, type, ref_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, type, ref_id) DO UPDATE SET
         date = excluded.date, summary = excluded.summary, created_at = excluded.created_at`,
    )
    .bind(a.userId, a.date, a.type, a.refId, JSON.stringify(a.summary), a.now);
}

export function removeActivity(db: D1Database, userId: string, type: ActivityType, refId: string): D1PreparedStatement {
  return db.prepare('DELETE FROM activities WHERE user_id = ? AND type = ? AND ref_id = ?').bind(userId, type, refId);
}
