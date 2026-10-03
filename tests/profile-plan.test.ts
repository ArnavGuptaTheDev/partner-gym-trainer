import { describe, expect, it } from 'vitest';
import { api, env, newPair, newUser } from './helpers';

describe('profile and weights', () => {
  it('saves partial profile updates and reports current weight', async () => {
    const u = await newUser();
    await api('PATCH', '/api/u/me/profile', { cookie: u.cookie, body: { heightCm: 172, targetWeightKg: 65, goalMode: 'lose', targetDate: '2027-01-01' } });
    await api('PATCH', '/api/u/me/profile', { cookie: u.cookie, body: { units: 'imperial' } });
    await api('PUT', '/api/u/me/weights/2026-01-01', { cookie: u.cookie, body: { weightKg: 72 } });
    await api('PUT', '/api/u/me/weights/2026-01-05', { cookie: u.cookie, body: { weightKg: 71.4 } });

    const p = await api('GET', '/api/u/me/profile', { cookie: u.cookie });
    expect(p.data).toMatchObject({
      heightCm: 172,
      targetWeightKg: 65,
      goalMode: 'lose',
      targetDate: '2027-01-01',
      units: 'imperial',
      startWeightKg: 72, // first weigh-in
      currentWeightKg: 71.4,
      currentWeightDate: '2026-01-05',
    });

    await api('PATCH', '/api/u/me/profile', { cookie: u.cookie, body: { targetDate: null } });
    expect((await api('GET', '/api/u/me/profile', { cookie: u.cookie })).data.targetDate).toBeNull();
  });

  it('upserts one weight per day, paginates, and refuses future dates', async () => {
    const u = await newUser();
    for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      await api('PUT', `/api/u/me/weights/${d}`, { cookie: u.cookie, body: { weightKg: 80 } });
    }
    await api('PUT', '/api/u/me/weights/2026-01-03', { cookie: u.cookie, body: { weightKg: 79 } });
    const page1 = await api('GET', '/api/u/me/weights?limit=2', { cookie: u.cookie });
    expect(page1.data.items).toEqual([{ date: '2026-01-03', weightKg: 79 }, { date: '2026-01-02', weightKg: 80 }]);
    const page2 = await api('GET', `/api/u/me/weights?limit=2&cursor=${page1.data.nextCursor}`, { cookie: u.cookie });
    expect(page2.data.items).toEqual([{ date: '2026-01-01', weightKg: 80 }]);
    expect(page2.data.nextCursor).toBeNull();

    expect((await api('PUT', '/api/u/me/weights/2999-01-01', { cookie: u.cookie, body: { weightKg: 80 } })).status).toBe(400);
    expect((await api('PUT', '/api/u/me/weights/2026-02-30', { cookie: u.cookie, body: { weightKg: 80 } })).status).toBe(400);
    expect((await api('PUT', '/api/u/me/weights/2026-01-01', { cookie: u.cookie, body: { weightKg: 5 } })).status).toBe(400);
  });
});

describe('plans', () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    calorieGoal: 'deficit',
    calorieTarget: 1900,
    proteinG: 140,
    meals: [
      { name: 'Breakfast', items: 'Oats, berries' },
      { name: 'Lunch', items: 'Chicken bowl', notes: 'extra greens' },
    ],
    exercises: [
      { weekday: 1, name: 'Squat', equipment: 'Barbell', sets: 4, reps: '8', targetWeightKg: 60 },
      { weekday: 1, name: 'Leg press', equipment: 'Leg press machine', sets: 3, reps: '10-12' },
      { weekday: 3, name: 'Bench', equipment: 'Barbell', sets: 4, reps: '6' },
    ],
    ...over,
  });

  it('partner writes the whole plan; ids stay stable across edits', async () => {
    const { a, b } = await newPair();
    const first = await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ version: 0 }) });
    expect(first.status).toBe(200);
    expect(first.data.version).toBe(1);

    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.plan).toMatchObject({ calorieTarget: 1900, calorieGoal: 'deficit', proteinG: 140, version: 1, updatedByName: 'Alex' });
    expect(got.data.meals.map((m: any) => m.name)).toEqual(['Breakfast', 'Lunch']);
    expect(got.data.exercises).toHaveLength(3);

    // Edit: drop Bench, rename Squat, add a meal.
    const squat = got.data.exercises.find((e: any) => e.name === 'Squat');
    const legs = got.data.exercises.find((e: any) => e.name === 'Leg press');
    const second = await api('PUT', '/api/u/partner/plan', {
      cookie: a.cookie,
      body: plan({
        version: 1,
        meals: [...got.data.meals, { name: 'Snack', items: 'Yogurt' }],
        exercises: [{ ...squat, name: 'Back squat' }, legs],
      }),
    });
    expect(second.data.version).toBe(2);
    const after = await api('GET', '/api/u/partner/plan', { cookie: a.cookie });
    expect(after.data.exercises.map((e: any) => [e.id, e.name])).toEqual([[squat.id, 'Back squat'], [legs.id, 'Leg press']]);
    expect(after.data.meals).toHaveLength(3);
  });

  it('detects concurrent edits with the version number', async () => {
    const { a } = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ version: 0 }) });
    const stale = await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ version: 0 }) });
    expect(stale.status).toBe(409);
  });

  it('warns (but saves) when calories are set below 1200', async () => {
    const { a, b } = await newPair();
    const res = await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ calorieTarget: 1000 }) });
    expect(res.status).toBe(200);
    expect(res.data.warnings).toEqual(['calories_low']);
    expect((await api('GET', '/api/u/me/plan', { cookie: b.cookie })).data.warnings).toEqual(['calories_low']);
  });

  it('cannot hijack another user’s plan rows by id', async () => {
    const p1 = await newPair();
    const p2 = await newPair();
    await api('PUT', '/api/u/partner/plan', { cookie: p1.a.cookie, body: plan() });
    const victim = await api('GET', '/api/u/me/plan', { cookie: p1.b.cookie });
    const target = victim.data.exercises[0];
    await api('PUT', '/api/u/partner/plan', {
      cookie: p2.a.cookie,
      body: plan({ exercises: [{ ...target, name: 'HACKED' }] }),
    });
    const row = await env.DB.prepare('SELECT name, user_id FROM plan_exercises WHERE id = ?').bind(target.id).first();
    expect(row).toEqual({ name: target.name, user_id: p1.b.id });
  });

  it('validates plan bodies', async () => {
    const { a } = await newPair();
    const bad = await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: plan({ exercises: [{ weekday: 9, name: 'x' }] }) });
    expect(bad.status).toBe(400);
    expect(bad.data.error.details.field).toBe('exercises[0].weekday');
  });
});
