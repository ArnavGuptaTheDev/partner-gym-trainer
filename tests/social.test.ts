import { describe, expect, it } from 'vitest';
import { addDays, isoDate } from '../worker/dates';
import { currentStreak, intersect, qualifyingMilestones } from '../worker/milestones';
import { api, env, newPair, newUser, type TestUser } from './helpers';

const TODAY = isoDate(Date.now());

describe('streaks and milestones (unit)', () => {
  it('counts consecutive days, with grace until midnight', () => {
    const d = (n: number) => addDays('2026-06-10', -n);
    expect(currentStreak([d(0), d(1), d(2)], d(0))).toBe(3);
    expect(currentStreak([d(1), d(2)], d(0))).toBe(2); // today not logged yet
    expect(currentStreak([d(2), d(3)], d(0))).toBe(0); // missed yesterday
    expect(intersect([d(0), d(1), d(2)], [d(0), d(2)])).toEqual([d(0), d(2)]);
  });

  it('awards weight milestones in the goal’s direction', () => {
    expect(qualifyingMilestones(0, { startKg: 80, currentKg: 79, targetKg: 70 })).toEqual(['first_kg']);
    expect(qualifyingMilestones(0, { startKg: 80, currentKg: 75, targetKg: 70 })).toEqual(['first_kg', 'halfway']);
    expect(qualifyingMilestones(0, { startKg: 80, currentKg: 70, targetKg: 70 })).toEqual(['first_kg', 'halfway', 'target']);
    expect(qualifyingMilestones(0, { startKg: 80, currentKg: 82, targetKg: 70 })).toEqual([]); // wrong way
    expect(qualifyingMilestones(0, { startKg: 60, currentKg: 61.2, targetKg: 66 })).toEqual(['first_kg']); // gaining
    expect(qualifyingMilestones(30, { startKg: null, currentKg: null, targetKg: null })).toEqual(['streak_7', 'streak_30']);
  });
});

async function logDays(u: TestUser, n: number) {
  for (let i = 0; i < n; i++) {
    await api('PATCH', `/api/u/me/days/${addDays(TODAY, -i)}`, { cookie: u.cookie, body: { waterMl: 500 } });
  }
}

describe('home, feed and cute features', () => {
  it('computes individual and shared streaks', async () => {
    const { a, b } = await newPair();
    await logDays(a, 3);
    await logDays(b, 2);
    const home = await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie });
    expect(home.data.streaks).toEqual({ me: 3, partner: 2, shared: 2, bothLoggedToday: true });
  });

  it('awards a 7-day streak milestone once, posts it to the feed, and clears on seen', async () => {
    const { a, b } = await newPair();
    await logDays(a, 7);
    const home = await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie });
    expect(home.data.newMilestones.map((m: any) => m.kind)).toEqual(['streak_7']);
    const again = await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie });
    expect(again.data.newMilestones).toHaveLength(1); // still unseen, not duplicated

    const feed = await api('GET', '/api/u/partner/feed', { cookie: b.cookie });
    expect(feed.data.items.some((x: any) => x.type === 'milestone' && x.summary.kind === 'streak_7')).toBe(true);

    await api('POST', '/api/milestones/seen', { cookie: a.cookie });
    expect((await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie })).data.newMilestones).toEqual([]);
  });

  it('awards weight milestones from logged weights', async () => {
    const { a } = await newPair();
    await api('PATCH', '/api/u/me/profile', { cookie: a.cookie, body: { startWeightKg: 80, targetWeightKg: 76 } });
    await api('PUT', `/api/u/me/weights/${TODAY}`, { cookie: a.cookie, body: { weightKg: 78 } });
    const home = await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie });
    expect(home.data.newMilestones.map((m: any) => m.kind).sort()).toEqual(['first_kg', 'halfway']);
  });

  it('shows the partner’s day on Home and lets you react to it (only theirs)', async () => {
    const { a, b } = await newPair();
    await api('POST', `/api/u/me/days/${TODAY}/exercises`, { cookie: b.cookie, body: { name: 'Deadlift' } });
    const home = await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie });
    const item = home.data.partnerActivity[0];
    expect(item).toMatchObject({ type: 'workout', summary: { done: 1, names: ['Deadlift'] } });

    expect((await api('POST', '/api/reactions', { cookie: a.cookie, body: { activityId: item.id, emoji: '🔥' } })).status).toBe(201);
    expect((await api('POST', '/api/reactions', { cookie: a.cookie, body: { activityId: item.id, emoji: '🔥' } })).status).toBe(201); // idempotent
    expect((await api('POST', '/api/reactions', { cookie: b.cookie, body: { activityId: item.id, emoji: '🔥' } })).status).toBe(404); // own
    expect((await api('POST', '/api/reactions', { cookie: a.cookie, body: { activityId: item.id, emoji: '💩' } })).status).toBe(400);

    const bHome = await api('GET', `/api/home?date=${TODAY}`, { cookie: b.cookie });
    expect(bHome.data.myActivity[0].reactions).toEqual([{ emoji: '🔥', fromUserId: a.id }]);

    await api('DELETE', `/api/reactions/${item.id}/${encodeURIComponent('🔥')}`, { cookie: a.cookie });
    expect((await api('GET', '/api/u/me/feed', { cookie: b.cookie })).data.items[0].reactions).toEqual([]);
  });

  it('a stranger cannot react to someone’s activity', async () => {
    const { b } = await newPair();
    await api('POST', `/api/u/me/days/${TODAY}/exercises`, { cookie: b.cookie, body: { name: 'Row' } });
    const act = await env.DB.prepare('SELECT id FROM activities WHERE user_id = ?').bind(b.id).first<{ id: number }>();
    const other = await newPair();
    expect((await api('POST', '/api/reactions', { cookie: other.a.cookie, body: { activityId: act!.id, emoji: '🔥' } })).status).toBe(404);
  });

  it('sends nudges with a cooldown and surfaces them via pulse', async () => {
    const { a, b } = await newPair();
    expect((await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'gym' } })).status).toBe(201);
    expect((await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'gym' } })).status).toBe(429);
    expect((await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'proud' } })).status).toBe(201);

    const pulse = await api('GET', '/api/pulse', { cookie: b.cookie });
    expect(pulse.data.nudges.map((n: any) => n.kind).sort()).toEqual(['gym', 'proud']);
    expect(pulse.data.nudges[0].fromName).toBe('Alex');
    await api('POST', '/api/nudges/seen', { cookie: b.cookie });
    expect((await api('GET', '/api/pulse', { cookie: b.cookie })).data.nudges).toEqual([]);
    expect((await api('POST', '/api/nudges', { cookie: (await newUser()).cookie, body: { kind: 'gym' } })).status).toBe(404);
  });

  it('leaves a note of the day on the partner’s home', async () => {
    const { a, b } = await newPair('couple');
    await api('PUT', `/api/notes/${TODAY}`, { cookie: a.cookie, body: { body: 'You got this ❤️' } });
    expect((await api('GET', `/api/home?date=${TODAY}`, { cookie: b.cookie })).data.noteForMe).toEqual({ body: 'You got this ❤️', fromName: 'Alex' });
    expect((await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie })).data.noteForPartner).toBe('You got this ❤️');
    await api('PUT', `/api/notes/${TODAY}`, { cookie: a.cookie, body: { body: '' } });
    expect((await api('GET', `/api/home?date=${TODAY}`, { cookie: b.cookie })).data.noteForMe).toBeNull();
  });

  it('works for unpaired users and paginates the feed', async () => {
    const solo = await newUser();
    await logDays(solo, 3);
    const home = await api('GET', `/api/home?date=${TODAY}`, { cookie: solo.cookie });
    expect(home.status).toBe(200);
    expect(home.data.streaks).toMatchObject({ me: 3, partner: 0, shared: 0 });
    expect(home.data.today.partner).toBeNull();

    const p1 = await api('GET', '/api/u/me/feed?limit=2', { cookie: solo.cookie });
    expect(p1.data.items).toHaveLength(2);
    const p2 = await api('GET', `/api/u/me/feed?limit=2&cursor=${p1.data.nextCursor}`, { cookie: solo.cookie });
    expect(p2.data.items).toHaveLength(1);
    expect(p2.data.nextCursor).toBeNull();
  });
});
