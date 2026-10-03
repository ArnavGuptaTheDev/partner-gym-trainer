import { badRequest } from './http';

const DAY = 86_400_000;

export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const addDays = (date: string, n: number) => isoDate(new Date(`${date}T00:00:00Z`).getTime() + n * DAY);

/**
 * Log dates come from the client's local calendar. Accept anything up to one
 * day ahead of UTC (time zones) and back about a year (backfilling).
 */
export function assertLogDate(date: string, now: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  // Round-trip so rolled-over dates like 2026-02-30 are rejected.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(ms) || isoDate(ms) !== date) {
    throw badRequest('date: must be a date (YYYY-MM-DD)', { field: 'date' });
  }
  if (date > isoDate(now + DAY)) throw badRequest('date: can’t log the future', { field: 'date' });
  if (date < isoDate(now - 400 * DAY)) throw badRequest('date: too far in the past', { field: 'date' });
  return date;
}
