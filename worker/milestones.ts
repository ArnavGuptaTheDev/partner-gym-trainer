// Pure streak/milestone logic, unit tested separately from the routes.
import { addDays } from './dates';

export type MilestoneKind = 'first_kg' | 'halfway' | 'target' | 'streak_7' | 'streak_30' | 'streak_100';

/**
 * Consecutive logged days ending today. If today isn't logged yet the streak
 * is still alive from yesterday (you have until midnight).
 */
export function currentStreak(dates: Iterable<string>, today: string): number {
  const set = new Set(dates);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function intersect(a: Iterable<string>, b: Iterable<string>): string[] {
  const sb = new Set(b);
  return [...new Set(a)].filter((d) => sb.has(d));
}

export interface WeightState {
  startKg: number | null;
  currentKg: number | null;
  targetKg: number | null;
}

/** Milestones the user currently qualifies for (already-earned ones included). */
export function qualifyingMilestones(streak: number, w: WeightState): MilestoneKind[] {
  const out: MilestoneKind[] = [];
  if (streak >= 7) out.push('streak_7');
  if (streak >= 30) out.push('streak_30');
  if (streak >= 100) out.push('streak_100');

  const { startKg: s, currentKg: c, targetKg: t } = w;
  if (s != null && c != null && t != null && Math.abs(s - t) >= 0.5) {
    const dir = Math.sign(t - s); // -1 losing, +1 gaining
    const moved = (c - s) * dir; // progress in the goal's direction
    const total = Math.abs(t - s);
    if (moved >= 1) out.push('first_kg');
    if (moved >= total / 2) out.push('halfway');
    if (moved >= total - 0.05) out.push('target');
  }
  return out;
}
