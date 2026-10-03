// Converts the hand-made static plan page (the "Sia ka Arnav" format) into a
// plan body for PUT /api/u/:who/plan. Pure string parsing: the page is
// small and regular, and this runs in Node (import script) and in tests.

import { EXERCISE_ICONS, type ExerciseIcon } from './plan';

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export interface ParsedPlan {
  title: string;
  tagline: string;
  days: { weekday: number; title: string; note: string; isRest?: boolean; restMessage?: string; sameAs?: number }[];
  exercises: {
    weekday: number;
    name: string;
    altName: string;
    muscles: string;
    notes: string;
    sets: number | null;
    repsMin: number | null;
    repsMax: number | null;
    repsSuffix: string;
    icon: ExerciseIcon | null;
  }[];
  dietTitle: string;
  dietIntro: string;
  dietTips: string;
  stock: { emoji: string; label: string }[];
  meals: { timeLabel: string; name: string; itemList: { text: string; or: string[] }[] }[];
  /** Things the parser couldn't place, for the preview. */
  warnings: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export const text = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Inner HTML of the first element with `cls` in its class list. */
function byClass(html: string, tag: string, cls: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  return html.match(re)?.[1] ?? null;
}
function allByClass(html: string, tag: string, cls: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...html.matchAll(re)].map((m) => m[1]);
}
const firstTag = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? null;

/** "Push-ups (or Bench Press)" → name + alternative. Slash names stay whole. */
export function splitName(raw: string): { name: string; altName: string } {
  const m = raw.match(/^(.*?)\s*\(\s*or\s+(.+?)\s*\)\s*$/i);
  return m ? { name: m[1].trim(), altName: m[2].trim() } : { name: raw.trim(), altName: '' };
}

/** "4×8-10", "3x12 each", "3×15-20" → sets and reps. */
export function parseSetsReps(raw: string) {
  const m = raw.trim().match(/^(\d+)\s*[×x]\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(.*)$/i);
  if (!m) return null;
  return { sets: Number(m[1]), repsMin: Number(m[2]), repsMax: m[3] ? Number(m[3]) : null, repsSuffix: m[4].trim() };
}

/** "Mon / Thu" → [1, 4]; "Sunday" → [0]. */
export function tabWeekdays(label: string): number[] {
  return label
    .split(/[\/,&]|\band\b/i)
    .map((part) => WEEKDAYS[part.trim().slice(0, 3).toLowerCase()])
    .filter((d): d is number => d !== undefined);
}

const EMOJI_LEAD = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*)\s*(.*)$/u;

export function parsePlanHtml(html: string): ParsedPlan {
  const warnings: string[] = [];
  const out: ParsedPlan = { title: '', tagline: '', days: [], exercises: [], dietTitle: '', dietIntro: '', dietTips: '', stock: [], meals: [], warnings };

  out.title = text(firstTag(html, 'title') ?? '');
  out.tagline = text(byClass(html, 'p', 'tagline') ?? '');

  // Tabs map section ids to weekdays; the first weekday owns the list.
  const tabs = [...html.matchAll(/<button\b[^>]*data-target="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => ({ id: m[1], label: text(m[2]) }));
  const sections = new Map([...html.matchAll(/<section\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi)].map((m) => [m[1], m[2]]));

  for (const tab of tabs) {
    const body = sections.get(tab.id);
    if (!body) {
      warnings.push(`Tab "${tab.label}" has no matching section`);
      continue;
    }
    if (tab.id === 'diet') {
      parseDiet(body, out);
      continue;
    }
    const days = tabWeekdays(tab.label);
    if (!days.length) {
      warnings.push(`Couldn't tell which weekday "${tab.label}" is`);
      continue;
    }
    const [primary, ...others] = days;
    const head = byClass(body, 'div', 'day-head') ?? '';
    const title = text(firstTag(head, 'h2') ?? '');
    const note = text(firstTag(head, 'p') ?? '');
    // Cards and the rest box contain nested divs, so slice rather than match.
    const restAt = body.search(/class="[^"]*\brest-box\b/);
    const rest = restAt >= 0 ? body.slice(restAt) : null;
    if (rest) {
      out.days.push({ weekday: primary, title, note, isRest: true, restMessage: text(firstTag(rest, 'p') ?? '') });
      for (const d of others) out.days.push({ weekday: d, title, note, isRest: true, restMessage: text(firstTag(rest, 'p') ?? '') });
      continue;
    }
    out.days.push({ weekday: primary, title, note });
    for (const d of others) out.days.push({ weekday: d, title: '', note: '', sameAs: primary });

    for (const c of body.split(/<div class="card">/i).slice(1)) {
      const iconId = c.match(/<use\s+href="#i-([a-z-]+)"/i)?.[1] ?? '';
      const icon = (EXERCISE_ICONS as readonly string[]).includes(iconId) ? (iconId as ExerciseIcon) : null;
      if (iconId && !icon) warnings.push(`Unknown icon "${iconId}"`);
      const { name, altName } = splitName(text(firstTag(c, 'h3') ?? ''));
      const setsRaw = text(byClass(c, 'div', 'n') ?? '');
      const sr = parseSetsReps(setsRaw);
      if (setsRaw && !sr) warnings.push(`Couldn't read sets/reps "${setsRaw}" for ${name}`);
      out.exercises.push({
        weekday: primary,
        name,
        altName,
        muscles: text(byClass(c, 'div', 'meta') ?? ''),
        notes: text(byClass(c, 'div', 'note') ?? ''),
        sets: sr?.sets ?? null,
        repsMin: sr?.repsMin ?? null,
        repsMax: sr?.repsMax ?? null,
        repsSuffix: sr?.repsSuffix ?? '',
        icon,
      });
    }
  }
  return out;
}

function parseDiet(body: string, out: ParsedPlan) {
  const head = byClass(body, 'div', 'day-head') ?? '';
  out.dietTitle = text(firstTag(head, 'h2') ?? '');
  out.dietIntro = text(firstTag(head, 'p') ?? '');

  // Each meal: time label, heading, list items. "OR …" items become
  // alternatives of the item before them.
  const mealBlocks = body.split(/<div class="meal">/i).slice(1);
  for (const block of mealBlocks) {
    const items: { text: string; or: string[] }[] = [];
    for (const li of [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => text(m[1]))) {
      const alt = li.match(/^or\s+(.+)$/i);
      if (alt && items.length) items[items.length - 1].or.push(alt[1].trim());
      else items.push({ text: li, or: [] });
    }
    out.meals.push({ timeLabel: text(byClass(block, 'div', 'meal-time') ?? ''), name: text(firstTag(block, 'h4') ?? ''), itemList: items });
  }

  for (const chip of allByClass(body, 'span', 'chip').map(text)) {
    const m = chip.match(EMOJI_LEAD);
    out.stock.push(m ? { emoji: m[1], label: m[2].trim() } : { emoji: '', label: chip });
  }
  out.dietTips = text(byClass(body, 'div', 'tip-box') ?? '');
}
