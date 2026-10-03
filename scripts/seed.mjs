// Seeds the LOCAL D1 database and R2 bucket with two paired demo users and a
// week of data. Safe to re-run: it deletes the demo users first.
//
//   npm run db:migrate:local && npm run db:seed:local
//
// Logins: alex@example.com / sam@example.com, password "spotter-demo-1".
// Add alex@example.com to SUPER_USER_EMAILS in .dev.vars to try the admin page.
import { execSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PASSWORD = 'spotter-demo-1';
const ITER = 100_000;
const DB = 'spotter';
const BUCKET = 'spotter-photos';

const b64 = (buf) => Buffer.from(buf).toString('base64');
async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const id = () => crypto.randomUUID();
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9 + (n % 5), 15, 0, 0);
  return d;
};

const sql = [];
const insert = (table, row) => {
  const cols = Object.keys(row);
  sql.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`);
};

const now = Date.now();
const alex = { id: id(), email: 'alex@example.com', name: 'Alex' };
const sam = { id: id(), email: 'sam@example.com', name: 'Sam' };

sql.push(`DELETE FROM users WHERE email IN (${q(alex.email)}, ${q(sam.email)});`);
for (const u of [alex, sam]) {
  const pw = await hash(PASSWORD);
  insert('users', { id: u.id, email: u.email, display_name: u.name, pw_hash: pw.hash, pw_salt: pw.salt, pw_iter: ITER, timezone: 'UTC', created_at: now - 8 * 864e5 });
}
const pairId = id();
insert('pairs', { id: pairId, user_a_id: alex.id, user_b_id: sam.id, pair_type: 'couple', allow_self_edit: 0, together_since: '2023-05-20', created_at: now - 8 * 864e5 });

insert('profiles', { user_id: alex.id, height_cm: 178, start_weight_kg: 86, target_weight_kg: 80, goal_mode: 'lose', target_date: localDate(daysAgo(-120)), updated_at: now });
insert('profiles', { user_id: sam.id, height_cm: 165, start_weight_kg: 57.5, target_weight_kg: 61, goal_mode: 'gain', target_date: localDate(daysAgo(-150)), updated_at: now });

// Plans: each written by the other person.
const plans = {
  [alex.id]: {
    by: sam.id,
    calories: 2100, goal: 'deficit', protein: 160,
    meals: [['Breakfast', 'Greek yogurt, berries, granola'], ['Lunch', 'Chicken rice bowl, lots of veg'], ['Snack', 'Protein shake + banana'], ['Dinner', 'Salmon, potatoes, greens']],
    days: {
      1: [['Back squat', 'Squat rack', 4, '6-8', 80], ['Leg press', 'Leg press machine', 3, '10-12', 140], ['Walking lunges', 'Dumbbells', 3, '12', 16]],
      3: [['Bench press', 'Flat bench', 4, '6-8', 70], ['Lat pulldown', 'Cable stack', 3, '10', 55], ['Incline DB press', 'Adjustable bench', 3, '10', 24]],
      5: [['Deadlift', 'Platform', 3, '5', 110], ['Seated row', 'Row machine', 3, '12', 60], ['Plank', 'Mat', 3, '45s', null]],
      6: [['Incline walk', 'Treadmill', 1, '30 min', null]],
    },
  },
  [sam.id]: {
    by: alex.id,
    calories: 2300, goal: 'surplus', protein: 120,
    meals: [['Breakfast', 'Oats, peanut butter, milk'], ['Lunch', 'Pasta with turkey mince'], ['Snack', 'Toast + eggs'], ['Dinner', 'Steak, rice, salad']],
    days: {
      1: [['Hip thrust', 'Hip thrust machine', 4, '8-10', 60], ['Romanian deadlift', 'Barbell', 3, '10', 40]],
      2: [['Shoulder press', 'Smith machine', 3, '10', 25], ['Cable lateral raise', 'Cable stack', 3, '15', 5]],
      4: [['Goblet squat', 'Kettlebell', 4, '10', 20], ['Leg curl', 'Leg curl machine', 3, '12', 30]],
      6: [['Bike intervals', 'Spin bike', 1, '20 min', null]],
    },
  },
};

const planIds = {};
for (const [userId, p] of Object.entries(plans)) {
  insert('plans', { user_id: userId, calorie_target: p.calories, calorie_goal: p.goal, protein_g: p.protein, version: 1, updated_by: p.by, updated_at: now - 7 * 864e5 });
  planIds[userId] = { meals: [], ex: {} };
  p.meals.forEach(([name, items], i) => {
    const mid = id();
    planIds[userId].meals.push({ id: mid, name, items });
    insert('plan_meals', { id: mid, user_id: userId, position: i, name, items, notes: '' });
  });
  for (const [wd, list] of Object.entries(p.days)) {
    planIds[userId].ex[wd] = [];
    list.forEach(([name, equipment, sets, reps, w], i) => {
      const eid = id();
      planIds[userId].ex[wd].push({ id: eid, name, equipment, sets, reps, w });
      insert('plan_exercises', { id: eid, user_id: userId, weekday: Number(wd), position: i, name, equipment, sets, reps, target_weight_kg: w, notes: '' });
    });
  }
}

const activity = (userId, date, type, refId, summary, at) =>
  insert('activities', { user_id: userId, date, type, ref_id: refId, summary: JSON.stringify(summary), created_at: at });

// A week of logs. Sam skipped 4 days ago, so Alex has a 7-day streak (and
// will unlock the 7-day milestone on first Home load) while the shared
// streak is 4.
const weights = { [alex.id]: [86, 85.6, 85.4, 85.5, 85.0, 84.8, 84.6], [sam.id]: [57.5, 57.8, 57.9, 58.1, 58.0, 58.3, 58.6] };
let photoN = 0;
const photos = [];
for (let n = 6; n >= 0; n--) {
  const d = daysAgo(n);
  const date = localDate(d);
  const wd = d.getDay();
  const at = d.getTime();
  for (const user of [alex, sam]) {
    if (user === sam && n === 4) continue;
    const ids = planIds[user.id];
    const w = weights[user.id][6 - n];
    insert('weight_logs', { user_id: user.id, date, weight_kg: w, created_at: at });
    activity(user.id, date, 'weight', date, { weightKg: w }, at);

    const water = 1500 + ((n * 350) % 1250);
    insert('day_logs', { user_id: user.id, date, calories_burned: 250 + n * 20, water_ml: water, updated_at: at });
    activity(user.id, date, 'day', date, { waterMl: water, caloriesBurned: 250 + n * 20 }, at + 1000);

    const planned = ids.ex[wd] ?? [];
    const done = n === 0 ? planned.slice(0, 1) : planned;
    done.forEach((e, i) => {
      insert('exercise_logs', { id: id(), user_id: user.id, date, plan_exercise_id: e.id, name: e.name, equipment: e.equipment, sets: e.sets, reps: String(e.reps), weight_kg: e.w, done: 1, notes: '', created_at: at + 60_000 * (i + 2) });
    });
    if (done.length) activity(user.id, date, 'workout', date, { done: done.length, names: done.slice(0, 4).map((e) => e.name) }, at + 600_000);

    const meals = n === 0 ? ids.meals.slice(0, 2) : ids.meals;
    let kcal = 0;
    meals.forEach((m, i) => {
      const cal = [450, 650, 300, 700][i];
      kcal += cal;
      insert('meal_logs', { id: id(), user_id: user.id, date, plan_meal_id: m.id, name: m.name, description: m.items, calories: cal, created_at: at + 3_600_000 * (i + 1) });
    });
    if (meals.length) activity(user.id, date, 'meal', date, { count: meals.length, calories: kcal }, at + 3_600_000 * meals.length);

    if (n % 3 === 0 && photoN < 4) {
      const pid = id();
      const key = `u/${user.id}/${pid}.jpg`;
      photoN++;
      photos.push({ key, file: `scripts/seed-photos/demo-${photoN}.jpg` });
      insert('photos', { id: pid, user_id: user.id, kind: 'gym', date, r2_key: key, bytes: 18_000, width: 600, height: 750, mime: 'image/jpeg', caption: ['Leg day done ✅', 'New PR!', 'Sweaty but happy', 'Sunday cardio'][photoN - 1], created_at: at + 7_000_000 });
      activity(user.id, date, 'photo', pid, { photoId: pid, caption: '' }, at + 7_000_000);
    }
  }
}

// A little conversation, a note, a nudge and a reaction.
const chat = [
  [sam, 5, 'Leg day tomorrow? 🦵'],
  [alex, 5, 'Only if you spot me on squats 😅'],
  [sam, 3, 'Proud of you for not skipping cardio ❤️'],
  [alex, 1, 'Updated your Tuesday, more shoulders 💪'],
  [sam, 0, 'Gym at 6?'],
  [alex, 0, '🔥🔥'],
];
for (const [u, n, body] of chat) insert('messages', { pair_id: pairId, sender_id: u.id, body, created_at: daysAgo(n).getTime() + 5_000_000 });
insert('day_notes', { pair_id: pairId, to_user: alex.id, date: localDate(new Date()), from_user: sam.id, body: 'Seven days straight. I see you 😍', created_at: now });
insert('nudges', { id: id(), pair_id: pairId, from_user: sam.id, to_user: alex.id, kind: 'proud', created_at: now - 60_000 });
sql.push(
  `INSERT INTO reactions (id, pair_id, from_user, activity_id, emoji, created_at)
   SELECT ${q(id())}, ${q(pairId)}, ${q(alex.id)}, id, '🔥', ${now} FROM activities
   WHERE user_id = ${q(sam.id)} AND type = 'workout' ORDER BY id DESC LIMIT 1;`,
);

writeFileSync('seed.sql', sql.join('\n') + '\n');
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
run(`npx wrangler d1 execute ${DB} --local --file seed.sql`);
for (const p of photos) run(`npx wrangler r2 object put ${BUCKET}/${p.key} --file ${p.file} --content-type image/jpeg --local`);
console.log(`\nSeeded. Sign in as ${alex.email} or ${sam.email} with password "${PASSWORD}".`);
