// Everything is stored metric; these convert for display/input.
export type Units = 'metric' | 'imperial';

const KG_PER_LB = 0.45359237;

export const weightUnit = (u: Units) => (u === 'imperial' ? 'lb' : 'kg');

/** kg → display number in the user's units (1 decimal). */
export function toDisplayWeight(kg: number | null | undefined, u: Units): number | null {
  if (kg == null) return null;
  const v = u === 'imperial' ? kg / KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

/** Display number → kg. */
export function fromDisplayWeight(v: number, u: Units): number {
  return Math.round((u === 'imperial' ? v * KG_PER_LB : v) * 100) / 100;
}

export function fmtWeight(kg: number | null | undefined, u: Units): string {
  const v = toDisplayWeight(kg, u);
  return v == null ? '–' : `${v} ${weightUnit(u)}`;
}

export const heightUnit = (u: Units) => (u === 'imperial' ? 'in' : 'cm');
export const toDisplayHeight = (cm: number | null | undefined, u: Units) =>
  cm == null ? null : u === 'imperial' ? Math.round((cm / 2.54) * 10) / 10 : Math.round(cm);
export const fromDisplayHeight = (v: number, u: Units) => (u === 'imperial' ? Math.round(v * 2.54 * 10) / 10 : v);

/** Weekdays in display order, Monday first. 0 = Sunday (matches the API). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
export const dayShort = (d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];
export const dayLong = (d: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d];

/** Parses a number input; empty → null. */
export function num(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
