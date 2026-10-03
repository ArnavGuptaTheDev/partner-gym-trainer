// One-off: import a hand-made static plan page (e.g. sia-ka-arnav.html) as a
// user's plan, set by their partner.
//
// Preview only (default; reads, never writes):
//   node scripts/import-plan.mjs <page.html> [--user <email> --by <email> --remote|--local]
//
// Write (replaces that user's workout days, exercises, meals and diet):
//   node scripts/import-plan.mjs <page.html> --user <email> --by <email> --remote --apply --yes
// Add --fresh to also drop the existing calorie target/goal/macros (goal
// becomes surplus, the rest empty) instead of keeping them.
//
// Uses the app's own parser, validation and SQL (bundled from shared/ and
// worker/), so the result is exactly what a save from the editor would write.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a) => !a.startsWith('--') && !['--user', '--by'].includes(args[args.indexOf(a) - 1]));
const user = opt('--user')?.toLowerCase();
const by = opt('--by')?.toLowerCase();
const where = flag('--remote') ? '--remote' : flag('--local') ? '--local' : null;
const apply = flag('--apply');
// --fresh: don't keep the existing plan's calorie target/goal/macros either.
const fresh = flag('--fresh');

if (!file) {
  console.error('Usage: node scripts/import-plan.mjs <page.html> [--user <email> --by <email> --remote|--local] [--apply --yes]');
  process.exit(1);
}
if (apply && (!user || !by || !where)) {
  console.error('--apply needs --user, --by and --remote or --local.');
  process.exit(1);
}

// Bundle the app's parser/validation/SQL for Node.
const tmp = mkdtempSync(join(tmpdir(), 'spotter-import-'));
const bundle = join(tmp, 'entry.mjs');
await build({ entryPoints: ['scripts/lib/import-entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' });
const { parsePlanHtml, PlanBody, checkPlanRules, planWriteStatements, parse } = await import(pathToFileURL(bundle).href);

// ---------------------------------------------------------------------------
// 1. Parse and validate.

const { warnings, ...parsed } = parsePlanHtml(readFileSync(file, 'utf8'));
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const reps = (e) => (e.repsMin == null ? '' : `${e.repsMin}${e.repsMax != null ? `-${e.repsMax}` : ''}${e.repsSuffix ? ` ${e.repsSuffix}` : ''}`);

console.log(`\n=== Parsed: ${file} ===\n`);
console.log(`Plan:    ${parsed.title}`);
console.log(`Tagline: ${parsed.tagline}\n`);
for (const d of [...parsed.days].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))) {
  const label = d.sameAs != null ? `same as ${DAY[d.sameAs]}` : d.isRest ? 'REST' : d.title;
  console.log(`${DAY[d.weekday]}  ${label}${d.note && d.sameAs == null ? `\n       note: ${d.note}` : ''}${d.isRest ? `\n       message: ${d.restMessage}` : ''}`);
  for (const e of parsed.exercises.filter((x) => x.weekday === d.weekday)) {
    console.log(`       • ${e.name}${e.altName ? ` (or ${e.altName})` : ''}  ${e.sets}×${reps(e)}  [${e.icon ?? 'no icon'}]`);
    console.log(`         muscles: ${e.muscles}`);
    console.log(`         note:    ${e.notes}`);
  }
}
console.log(`\nDiet: ${parsed.dietTitle} — ${parsed.dietIntro}`);
for (const m of parsed.meals) {
  console.log(`  ${m.timeLabel.padEnd(14)} ${m.name}`);
  for (const it of m.itemList) {
    console.log(`  ${''.padEnd(14)}  - ${it.text}`);
    for (const o of it.or) console.log(`  ${''.padEnd(14)}      OR ${o}`);
  }
}
console.log(`\nKeep stocked (${parsed.stock.length}): ${parsed.stock.map((s) => `${s.emoji} ${s.label}`.trim()).join(' · ')}`);
console.log(`Tips: ${parsed.dietTips}`);
console.log(`\nCounts: ${parsed.days.length} days, ${parsed.exercises.length} exercises, ${parsed.meals.length} meals, ${parsed.stock.length} stock items`);
console.log(warnings.length ? `\nWARNINGS:\n  - ${warnings.join('\n  - ')}` : '\nParser warnings: none');

writeFileSync('plan-import.json', JSON.stringify(parsed, null, 2));
console.log('\nFull parsed JSON written to plan-import.json (git-ignored).');

// ---------------------------------------------------------------------------
// 2. Look up the two accounts (read-only).

if (!user || !by || !where) {
  console.log('\nPreview only. Add --user, --by and --remote/--local to check the accounts.');
  process.exit(0);
}

// Run wrangler's JS entry directly (no shell), so SQL arguments aren't
// re-quoted by cmd.exe/sh.
const WRANGLER = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const d1 = (args) =>
  execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'spotter', where, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const select = (sql) => JSON.parse(d1(['--json', '--command', sql]))[0].results;

// The import writes columns from migrations 0008/0009.
const applied = new Set(select(`SELECT name FROM d1_migrations`).map((r) => r.name));
const missing = ['0008_rich_workouts.sql', '0009_rich_diet.sql'].filter((m) => !applied.has(m));

const users = select(`SELECT id, email, display_name FROM users WHERE email IN (${q(user)}, ${q(by)})`);
const target = users.find((u) => u.email.toLowerCase() === user);
const editor = users.find((u) => u.email.toLowerCase() === by);
if (!target || !editor) {
  console.error(`\nAccount not found on ${where.slice(2)}: ${[!target && user, !editor && by].filter(Boolean).join(', ')}`);
  process.exit(1);
}
const [pair] = select(
  `SELECT pair_type FROM pairs WHERE (user_a_id = ${q(target.id)} AND user_b_id = ${q(editor.id)}) OR (user_a_id = ${q(editor.id)} AND user_b_id = ${q(target.id)})`,
);
const [existing] = select(`SELECT calorie_target, calorie_goal, protein_g, carbs_g, fat_g, version FROM plans WHERE user_id = ${q(target.id)}`);
const [counts] = select(
  `SELECT (SELECT count(*) FROM plan_exercises WHERE user_id = ${q(target.id)}) AS exercises,
          (SELECT count(*) FROM plan_meals WHERE user_id = ${q(target.id)}) AS meals,
          ${missing.length ? '0' : `(SELECT count(*) FROM plan_media WHERE user_id = ${q(target.id)})`} AS media,
          (SELECT count(*) FROM exercise_logs WHERE user_id = ${q(target.id)} AND plan_exercise_id IS NOT NULL) AS linkedLogs`,
);

console.log(`\n=== Target (${where.slice(2)}) ===`);
console.log(`Plan for: ${target.display_name} <${target.email}>`);
console.log(`Set by:   ${editor.display_name} <${editor.email}>`);
console.log(`Paired:   ${pair ? `yes (${pair.pair_type})` : 'NO'}`);
console.log(
  existing
    ? `Existing plan v${existing.version}: ${counts.exercises} exercises, ${counts.meals} meals will be replaced. ${
        fresh
          ? 'Calorie target/goal/macros are reset (--fresh): goal surplus, no target.'
          : `Calorie target/goal/macros are kept (${existing.calorie_target ?? '–'} kcal, ${existing.calorie_goal}).`
      }`
    : 'No existing plan; one will be created (goal: surplus, no calorie target).',
);
if (counts.linkedLogs) console.log(`${counts.linkedLogs} logged exercise(s) point at the current plan; they keep their history (names are snapshotted) but unlink from the old plan entries.`);
if (!pair) {
  console.error('\nThese two accounts are not paired with each other; refusing.');
  process.exit(1);
}
if (counts.media) {
  console.error(`\nThis plan already has ${counts.media} exercise photo(s); the import would orphan them. Refusing.`);
  process.exit(1);
}

const body = parse(PlanBody, {
  ...parsed,
  ...(fresh || !existing
    ? { calorieTarget: null, calorieGoal: 'surplus', proteinG: null, carbsG: null, fatG: null }
    : {
        calorieTarget: existing.calorie_target,
        calorieGoal: existing.calorie_goal,
        proteinG: existing.protein_g,
        carbsG: existing.carbs_g,
        fatG: existing.fat_g,
      }),
});
checkPlanRules(body);
console.log('\nValidation: passes the same checks as the app.');

if (missing.length) {
  console.log(`\nThe ${where.slice(2)} database is missing migrations: ${missing.join(', ')}.`);
  console.log(`Run \`npm run db:migrate:${where.slice(2)}\` first; the import can't be written until then.`);
  process.exit(apply ? 1 : 0);
}

if (!apply || !flag('--yes')) {
  console.log(`\nNothing written. To write, re-run with: --apply --yes`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 3. Write, using the app's own statements with parameters inlined.

const stmts = planWriteStatements({ userId: target.id, editorId: editor.id, body, now: Date.now(), newId: randomUUID });
const sql = stmts
  .map(({ sql: s, params }) => {
    const out = s.replace(/\?(\d+)/g, (_, n) => q(params[Number(n) - 1]));
    if (/\?(?!\d)/.test(out.replace(/'(?:[^']|'')*'/g, ''))) throw new Error('Unnumbered parameter in statement');
    return `${out.trim()};`;
  })
  .join('\n');
const sqlFile = join(tmp, 'plan-import.sql');
writeFileSync(sqlFile, sql);
console.log(`\nWriting ${stmts.length} statements to ${where.slice(2)}…`);
d1(['--file', sqlFile, '--yes']);
const [after] = select(`SELECT version, (SELECT count(*) FROM plan_exercises WHERE user_id = ${q(target.id)}) AS exercises FROM plans WHERE user_id = ${q(target.id)}`);
console.log(`Done. Plan is now v${after.version} with ${after.exercises} exercises.`);
