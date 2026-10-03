// Plan rules shared by the Worker (validation) and the browser (editor and
// cards), so both agree on icons, rep formatting and links.

/** Built-in exercise pictograms (drawn in src/islands/ExerciseIcon.tsx). */
export const EXERCISE_ICONS = [
  'press', 'dip', 'curl', 'pull', 'row', 'squat', 'lunge',
  'bridge', 'overhead', 'lateral', 'calf', 'hinge', 'kickback',
] as const;
export type ExerciseIcon = (typeof EXERCISE_ICONS)[number];

export const isExerciseIcon = (v: unknown): v is ExerciseIcon =>
  typeof v === 'string' && (EXERCISE_ICONS as readonly string[]).includes(v);

export const MAX_EXERCISE_PHOTOS = 3;
export const MAX_EXERCISE_LINKS = 3;

/**
 * "8", "8-10", "12 each", "10-12 each leg". Empty when there's no rep target.
 */
export function formatReps(min: number | null | undefined, max: number | null | undefined, suffix = ''): string {
  if (min == null) return suffix.trim();
  const range = max != null && max !== min ? `${min}-${max}` : `${min}`;
  return suffix.trim() ? `${range} ${suffix.trim()}` : range;
}

/** "4×8-10", "3×12 each", or "" when there's nothing to show. */
export function formatSetsReps(sets: number | null | undefined, reps: string): string {
  if (sets && reps) return `${sets}×${reps}`;
  if (sets) return `${sets} sets`;
  return reps;
}

/** Normalises an http(s) URL, or returns null for anything else. */
export function safeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/** The video id for YouTube watch, youtu.be, shorts, embed and live URLs. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = u.pathname.split('/')[1] ?? null;
  } else if (YT_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] ?? null;
  }
  return id && YT_ID.test(id) ? id : null;
}

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
