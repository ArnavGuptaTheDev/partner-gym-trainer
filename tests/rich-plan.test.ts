import { describe, expect, it } from 'vitest';
import { formatReps, formatSetsReps, safeHttpUrl, youtubeId } from '../shared/plan';
import { MAX_PLAN_MEDIA_UPLOADS_PER_DAY } from '../worker/routes/plan';
import { api, env, newPair, newUser, superCookie, type TestUser } from './helpers';

const MONDAY = '2026-06-01';
const THURSDAY = '2026-06-04';
const SUNDAY = '2026-06-07';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);

const squat = { weekday: 1, name: 'Squats', muscles: 'Quads, glutes', notes: 'Chest up', sets: 4, repsMin: 10, repsMax: 12, icon: 'squat' };
const lunge = { weekday: 1, name: 'Lunges', sets: 3, repsMin: 12, repsSuffix: 'each', icon: 'lunge' };

function plan(over: Record<string, unknown> = {}) {
  return {
    calorieGoal: 'surplus',
    title: 'Sia ka Arnav',
    tagline: 'Lift heavy, eat more, grow',
    days: [
      { weekday: 1, title: 'Legs', note: 'Add a rep each week' },
      { weekday: 4, sameAs: 1 },
      { weekday: 0, isRest: true, restMessage: 'Sleep 8 hours.' },
    ],
    meals: [],
    exercises: [squat, lunge],
    ...over,
  };
}

async function uploadMedia(u: TestUser, who: 'me' | 'partner') {
  const form = new FormData();
  form.set('file', new File([JPEG], 'p.jpg'));
  form.set('width', '600');
  form.set('height', '800');
  return api('POST', `/api/u/${who}/plan/media`, { cookie: u.cookie, rawBody: form });
}

describe('plan helpers (unit)', () => {
  it('formats reps and sets', () => {
    expect(formatReps(8, 10)).toBe('8-10');
    expect(formatReps(10, null)).toBe('10');
    expect(formatReps(12, 12, 'each')).toBe('12 each');
    expect(formatReps(null, null)).toBe('');
    expect(formatSetsReps(4, '8-10')).toBe('4×8-10');
    expect(formatSetsReps(3, '12 each')).toBe('3×12 each');
  });

  it('accepts only http(s) links', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHttpUrl(' http://x.co ')).toBe('http://x.co/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.co', 'notaurl', 'https://user:pw@x.co']) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
  });

  it('detects YouTube watch, youtu.be and shorts links', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}&t=30s`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://youtube.com/embed/${id}`,
    ]) {
      expect(youtubeId(url), url).toBe(id);
    }
    for (const url of ['https://www.youtube.com/channel/abc', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/short', 'javascript:youtu.be/dQw4w9WgXcQ']) {
      expect(youtubeId(url), url).toBeNull();
    }
  });
});

describe('richer workout plans', () => {
  it('stores days, structured reps, icons and links; shows them to both partners', async () => {
    const { a, b } = await newPair();
    const res = await api('PUT', '/api/u/partner/plan', {
      cookie: a.cookie,
      body: plan({ exercises: [{ ...squat, altName: 'Goblet squat', links: ['https://youtu.be/dQw4w9WgXcQ'] }, lunge] }),
    });
    expect(res.status).toBe(200);

    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.plan).toMatchObject({ title: 'Sia ka Arnav', tagline: 'Lift heavy, eat more, grow' });
    expect(got.data.days).toEqual([
      { weekday: 0, title: '', note: '', isRest: true, restMessage: 'Sleep 8 hours.', sameAs: null },
      { weekday: 1, title: 'Legs', note: 'Add a rep each week', isRest: false, restMessage: '', sameAs: null },
      { weekday: 4, title: '', note: '', isRest: false, restMessage: '', sameAs: 1 },
    ]);
    expect(got.data.exercises[0]).toMatchObject({
      name: 'Squats', altName: 'Goblet squat', muscles: 'Quads, glutes', notes: 'Chest up',
      sets: 4, repsMin: 10, repsMax: 12, reps: '10-12', icon: 'squat',
      links: ['https://youtu.be/dQw4w9WgXcQ'], media: [],
    });
    expect(got.data.exercises[1]).toMatchObject({ repsMin: 12, repsMax: null, repsSuffix: 'each', reps: '12 each' });
  });

  it('a shared day uses the source day’s list, so editing it changes both', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan() });

    const thu = await api('GET', `/api/u/me/days/${THURSDAY}`, { cookie: b.cookie });
    expect(thu.data.plannedExercises.map((e: any) => e.name)).toEqual(['Squats', 'Lunges']);
    expect(thu.data.planDay).toMatchObject({ title: 'Legs', note: 'Add a rep each week', sameAs: 1 });

    // Check-off on Thursday is independent of Monday.
    const sq = thu.data.plannedExercises[0];
    expect((await api('POST', `/api/u/me/days/${THURSDAY}/exercises`, { cookie: b.cookie, body: { planExerciseId: sq.id, sets: 4, reps: '12' } })).status).toBe(201);
    expect((await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: b.cookie, body: { planExerciseId: sq.id } })).status).toBe(201);

    const current = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    await api('PUT', '/api/u/partner/plan', {
      cookie: a.cookie,
      body: plan({ version: current.data.plan.version, exercises: [{ ...current.data.exercises[0], name: 'Back squat' }] }),
    });
    const thu2 = await api('GET', `/api/u/me/days/${THURSDAY}`, { cookie: b.cookie });
    expect(thu2.data.plannedExercises.map((e: any) => e.name)).toEqual(['Back squat']);

    const home = await api('GET', `/api/home?date=${THURSDAY}`, { cookie: a.cookie });
    expect(home.data.today.partner.exercisesPlanned).toBe(1);
  });

  it('shows rest days with their message', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan() });
    const sun = await api('GET', `/api/u/me/days/${SUNDAY}`, { cookie: b.cookie });
    expect(sun.data.plannedExercises).toEqual([]);
    expect(sun.data.planDay).toMatchObject({ isRest: true, restMessage: 'Sleep 8 hours.' });
  });

  it.each([
    ['chained same-as', { days: [{ weekday: 1 }, { weekday: 2, sameAs: 1 }, { weekday: 3, sameAs: 2 }] }, 'copies Tuesday'],
    ['same-as a rest day', { days: [{ weekday: 0, isRest: true }, { weekday: 4, sameAs: 0 }] }, 'rest day'],
    ['exercises on a shared day', { exercises: [{ ...squat, weekday: 4 }] }, "uses Monday's list"],
    ['exercises on a rest day', { exercises: [{ ...squat, weekday: 0 }] }, 'rest day'],
    ['duplicate weekdays', { days: [{ weekday: 1 }, { weekday: 1 }] }, 'twice'],
    ['max reps below min', { exercises: [{ ...squat, repsMin: 12, repsMax: 8 }] }, 'repsMax'],
    ['javascript: link', { exercises: [{ ...squat, links: ['javascript:alert(1)'] }] }, 'http or https'],
    ['unknown icon', { exercises: [{ ...squat, icon: 'rocket' }] }, 'icon'],
    ['four links', { exercises: [{ ...squat, links: ['https://a.co', 'https://b.co', 'https://c.co', 'https://d.co'] }] }, 'at most 3'],
  ])('rejects %s', async (_, over, message) => {
    const { a } = await newPair();
    const res = await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan(over) });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toContain(message);
  });

  it('keeps older free-text reps working', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ exercises: [{ weekday: 1, name: 'Plank', sets: 3, reps: '45s' }] }) });
    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.exercises[0]).toMatchObject({ reps: '45s', repsMin: null });
  });
});

describe('exercise photos', () => {
  it('editor uploads, the save attaches; owner and partner can view, strangers cannot', async () => {
    const { a, b } = await newPair();
    const up = await uploadMedia(a, 'partner');
    expect(up.status).toBe(201);
    expect(up.data.url).toBe(`/api/plan-media/${up.data.id}`);

    // The plan's owner can't add photos to their own plan unless self-editing is on.
    expect((await uploadMedia(b, 'me')).status).toBe(403);

    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ exercises: [{ ...squat, mediaIds: [up.data.id] }] }) });
    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.exercises[0].media).toEqual([{ id: up.data.id, url: up.data.url, width: 600, height: 800 }]);
    const day = await api('GET', `/api/u/me/days/${THURSDAY}`, { cookie: b.cookie });
    expect(day.data.plannedExercises[0].media).toHaveLength(1);

    expect((await api('GET', up.data.url, { cookie: b.cookie })).status).toBe(200);
    expect((await api('GET', up.data.url, { cookie: a.cookie })).status).toBe(200);
    expect((await api('GET', up.data.url, { cookie: (await newUser()).cookie })).status).toBe(404);
    expect((await api('GET', up.data.url)).status).toBe(401);
  });

  it('deletes the row and R2 object when a photo is removed from the plan', async () => {
    const { a, b } = await newPair();
    const up = await uploadMedia(a, 'partner');
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ exercises: [{ ...squat, mediaIds: [up.data.id] }] }) });
    const key = `plan/${b.id}/${up.data.id}.jpg`;
    expect(await env.PHOTOS.head(key)).not.toBeNull();

    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ exercises: [squat] }) });
    expect(await env.PHOTOS.head(key)).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM plan_media WHERE id = ?').bind(up.data.id).first()).toBeNull();
  });

  it('refuses photos that belong to another plan', async () => {
    const p1 = await newPair();
    const p2 = await newPair();
    const theirs = await uploadMedia(p2.a, 'partner');
    const res = await api('PUT', '/api/u/partner/plan', { cookie: p1.a.cookie, body: plan({ exercises: [{ ...squat, mediaIds: [theirs.data.id] }] }) });
    expect(res.status).toBe(400);
  });

  it('lazily removes unattached uploads older than a day, on upload and on save', async () => {
    const { a, b } = await newPair();
    const old1 = await uploadMedia(a, 'partner');
    const old2 = await uploadMedia(a, 'partner');
    const fresh = await uploadMedia(a, 'partner');
    const dayAgo = Date.now() - 25 * 3600_000;
    await env.DB.prepare('UPDATE plan_media SET created_at = ? WHERE id IN (?, ?)').bind(dayAgo, old1.data.id, old2.data.id).run();

    await uploadMedia(a, 'partner'); // triggers cleanup
    expect(await env.PHOTOS.head(`plan/${b.id}/${old1.data.id}.jpg`)).toBeNull();
    expect(await env.PHOTOS.head(`plan/${b.id}/${fresh.data.id}.jpg`)).not.toBeNull();

    const old3 = await uploadMedia(a, 'partner');
    await env.DB.prepare('UPDATE plan_media SET created_at = ? WHERE id = ?').bind(dayAgo, old3.data.id).run();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan() }); // save also cleans up
    expect(await env.DB.prepare('SELECT 1 FROM plan_media WHERE id = ?').bind(old3.data.id).first()).toBeNull();
    // A recent unattached upload survives (it may belong to an editor still open).
    expect(await env.DB.prepare('SELECT 1 FROM plan_media WHERE id = ?').bind(fresh.data.id).first()).not.toBeNull();
  });

  it(`has its own limit of ${MAX_PLAN_MEDIA_UPLOADS_PER_DAY} uploads per person per day`, async () => {
    const { a } = await newPair();
    for (let i = 0; i < MAX_PLAN_MEDIA_UPLOADS_PER_DAY; i++) expect((await uploadMedia(a, 'partner')).status).toBe(201);
    expect((await uploadMedia(a, 'partner')).status).toBe(429);
  });

  it('counts toward admin storage', async () => {
    const { a } = await newPair();
    await uploadMedia(a, 'partner');
    const res = await api('GET', '/api/admin/storage', { cookie: await superCookie() });
    expect(res.data.planMediaCount).toBeGreaterThanOrEqual(1);
    expect(res.data.totalBytes).toBeGreaterThanOrEqual(res.data.planMediaBytes);
  });
});

describe('richer diet plans', () => {
  const diet = {
    dietTitle: 'Weight Gain Diet',
    dietIntro: 'Simple home food, eaten consistently.',
    dietTips: 'Eat every 3 hours.',
    stock: [{ emoji: '🍌', label: 'Bananas' }, { label: 'Oats' }],
    meals: [
      {
        timeLabel: 'Breakfast',
        name: '~1 hour later',
        itemList: [{ text: 'Bowl of oats cooked in milk', or: ['3-4 boiled eggs with toast'] }, { text: 'A glass of milk' }],
      },
      { timeLabel: 'Before bed', name: 'Last thing at night', itemList: [{ text: 'Warm glass of milk' }] },
    ],
  };

  it('stores time labels, items with alternatives, stock chips, tips and header', async () => {
    const { a, b } = await newPair();
    expect((await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan(diet) })).status).toBe(200);
    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.plan).toMatchObject({
      dietTitle: 'Weight Gain Diet', dietIntro: 'Simple home food, eaten consistently.', dietTips: 'Eat every 3 hours.',
      stock: [{ emoji: '🍌', label: 'Bananas' }, { emoji: '', label: 'Oats' }],
    });
    expect(got.data.meals[0]).toMatchObject({
      timeLabel: 'Breakfast',
      name: '~1 hour later',
      itemList: [{ text: 'Bowl of oats cooked in milk', or: ['3-4 boiled eggs with toast'] }, { text: 'A glass of milk', or: [] }],
      items: 'Bowl of oats cooked in milk\nOR 3-4 boiled eggs with toast\nA glass of milk',
    });
  });

  it('logging a planned meal records its items as the description', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan(diet) });
    const day = await api('GET', `/api/u/me/days/${MONDAY}`, { cookie: b.cookie });
    expect(day.data.plannedMeals[1]).toMatchObject({ timeLabel: 'Before bed', itemList: [{ text: 'Warm glass of milk', or: [] }] });
    await api('POST', `/api/u/me/days/${MONDAY}/meals`, { cookie: b.cookie, body: { planMealId: day.data.plannedMeals[0].id, calories: 500 } });
    const after = await api('GET', `/api/u/me/days/${MONDAY}`, { cookie: b.cookie });
    expect(after.data.meals[0].description).toContain('OR 3-4 boiled eggs with toast');
  });

  it('keeps older free-text meals readable as one item per line', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ meals: [{ name: 'Lunch', items: 'Rice\nDal\n\nSalad' }] }) });
    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.meals[0]).toMatchObject({ timeLabel: '', items: 'Rice\nDal\n\nSalad' });
    expect(got.data.meals[0].itemList.map((i: any) => i.text)).toEqual(['Rice', 'Dal', 'Salad']);
  });

  it.each([
    ['too many stock chips', { stock: Array.from({ length: 41 }, (_, i) => ({ label: `x${i}` })) }],
    ['too many alternatives', { meals: [{ name: 'M', itemList: [{ text: 'a', or: ['1', '2', '3', '4', '5'] }] }] }],
    ['empty stock label', { stock: [{ emoji: '🍌', label: '' }] }],
  ])('rejects %s', async (_, over) => {
    const { a } = await newPair();
    expect((await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan(over) })).status).toBe(400);
  });
});
