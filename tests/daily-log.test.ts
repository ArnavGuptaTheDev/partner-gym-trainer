import { describe, expect, it } from 'vitest';
import { api, env, newPair } from './helpers';

const MONDAY = '2026-06-01'; // a Monday

async function setup() {
  const { a, b } = await newPair();
  await api('PUT', '/api/u/partner/plan', {
    cookie: a.cookie,
    body: {
      calorieGoal: 'deficit',
      calorieTarget: 2000,
      meals: [{ name: 'Breakfast', items: 'Oats' }],
      exercises: [
        { weekday: 1, name: 'Squat', equipment: 'Rack', sets: 4, reps: '8', targetWeightKg: 60 },
        { weekday: 1, name: 'Row', equipment: 'Cable', sets: 3, reps: '12' },
        { weekday: 2, name: 'Run', sets: 1, reps: '5k' },
      ],
    },
  });
  const plan = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
  return { a, b, plan: plan.data };
}

const activities = (userId: string) =>
  env.DB.prepare('SELECT type, ref_id, summary FROM activities WHERE user_id = ? AND type != ? ORDER BY id').bind(userId, 'plan').all<any>();

describe('daily log', () => {
  it('shows the weekday’s planned exercises and tracks progress against the plan', async () => {
    const { b, plan } = await setup();
    const day0 = await api('GET', `/api/u/me/days/${MONDAY}`, { cookie: b.cookie });
    expect(day0.data.plannedExercises.map((e: any) => e.name)).toEqual(['Squat', 'Row']);
    expect(day0.data.totals).toMatchObject({ plannedTotal: 2, plannedDone: 0, caloriesEaten: 0 });

    const squat = plan.exercises.find((e: any) => e.name === 'Squat');
    const log = await api('POST', `/api/u/me/days/${MONDAY}/exercises`, {
      cookie: b.cookie,
      body: { planExerciseId: squat.id, sets: 4, reps: '8,8,7,6', weightKg: 62.5 },
    });
    expect(log.status).toBe(201);
    // Checking off the same planned exercise twice is refused.
    expect((await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: b.cookie, body: { planExerciseId: squat.id } })).status).toBe(409);

    await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: b.cookie, body: { name: 'Stretching' } });
    await api('POST', `/api/u/me/days/${MONDAY}/meals`, { cookie: b.cookie, body: { planMealId: plan.meals[0].id, calories: 450, proteinG: 20 } });
    await api('POST', `/api/u/me/days/${MONDAY}/meals`, { cookie: b.cookie, body: { name: 'Snack', calories: 200 } });
    await api('PATCH', `/api/u/me/days/${MONDAY}`, { cookie: b.cookie, body: { waterMl: 1500, caloriesBurned: 320, weightKg: 70.2 } });

    const day = await api('GET', `/api/u/me/days/${MONDAY}`, { cookie: b.cookie });
    expect(day.data.exercises[0]).toMatchObject({ name: 'Squat', equipment: 'Rack', weightKg: 62.5, done: true });
    expect(day.data.meals[0]).toMatchObject({ name: 'Breakfast', description: 'Oats', calories: 450 });
    expect(day.data).toMatchObject({ waterMl: 1500, caloriesBurned: 320, weightKg: 70.2 });
    expect(day.data.totals).toMatchObject({ caloriesEaten: 650, proteinG: 20, exercisesDone: 2, plannedDone: 1, plannedTotal: 2 });
  });

  it('rolls workouts and meals into one feed item per day, kept in sync', async () => {
    const { b } = await setup();
    const one = await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: b.cookie, body: { name: 'Push-ups' } });
    await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: b.cookie, body: { name: 'Plank' } });
    const meal = await api('POST', `/api/u/me/days/${MONDAY}/meals`, { cookie: b.cookie, body: { name: 'Lunch', calories: 600 } });

    let acts = (await activities(b.id)).results;
    const workout = acts.find((x: any) => x.type === 'workout');
    expect(JSON.parse(workout.summary)).toEqual({ done: 2, names: ['Push-ups', 'Plank'] });
    expect(JSON.parse(acts.find((x: any) => x.type === 'meal').summary)).toEqual({ count: 1, calories: 600 });
    expect(acts.filter((x: any) => x.type === 'workout')).toHaveLength(1);

    // Unchecking reduces the count; deleting everything removes the item.
    await api('PATCH', `/api/u/me/exercises/${one.data.id}`, { cookie: b.cookie, body: { done: false } });
    acts = (await activities(b.id)).results;
    expect(JSON.parse(acts.find((x: any) => x.type === 'workout').summary).done).toBe(1);
    await api('DELETE', `/api/u/me/meals/${meal.data.id}`, { cookie: b.cookie });
    acts = (await activities(b.id)).results;
    expect(acts.find((x: any) => x.type === 'meal')).toBeUndefined();
  });

  it('lets the partner read the day but not write it', async () => {
    const { a, b } = await setup();
    const ex = await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: b.cookie, body: { name: 'Burpees' } });
    const read = await api('GET', `/api/u/partner/days/${MONDAY}`, { cookie: a.cookie });
    expect(read.data.exercises[0].name).toBe('Burpees');

    expect((await api('POST', `/api/u/partner/days/${MONDAY}/exercises`, { cookie: a.cookie, body: { name: 'x' } })).status).toBe(403);
    expect((await api('PATCH', `/api/u/partner/days/${MONDAY}`, { cookie: a.cookie, body: { waterMl: 1 } })).status).toBe(403);
    // Even via `me`, ids belonging to the partner are not found.
    expect((await api('PATCH', `/api/u/me/exercises/${ex.data.id}`, { cookie: a.cookie, body: { done: false } })).status).toBe(404);
    expect((await api('DELETE', `/api/u/me/exercises/${ex.data.id}`, { cookie: a.cookie })).status).toBe(404);
  });

  it('refuses to check off exercises from someone else’s plan', async () => {
    const { a, plan } = await setup(); // plan belongs to b
    const res = await api('POST', `/api/u/me/days/${MONDAY}/exercises`, { cookie: a.cookie, body: { planExerciseId: plan.exercises[0].id } });
    expect(res.status).toBe(404);
  });

  it('summarises a date range, capped at 62 days', async () => {
    const { b } = await setup();
    await api('POST', '/api/u/me/days/2026-06-01/meals', { cookie: b.cookie, body: { name: 'A', calories: 100 } });
    await api('POST', '/api/u/me/days/2026-06-03/exercises', { cookie: b.cookie, body: { name: 'B' } });
    const res = await api('GET', '/api/u/me/days?from=2026-06-01&to=2026-06-07', { cookie: b.cookie });
    expect(res.data.items).toEqual([
      { date: '2026-06-03', exercisesDone: 1 },
      { date: '2026-06-01', meals: 1, caloriesEaten: 100 },
    ]);
    expect((await api('GET', '/api/u/me/days?from=2026-01-01&to=2026-06-07', { cookie: b.cookie })).status).toBe(400);
  });
});
