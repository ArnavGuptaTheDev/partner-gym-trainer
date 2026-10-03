import { describe, expect, it } from 'vitest';
import { addDays, isoDate } from '../worker/dates';
import { DELETE_CONFIRMATION } from '../worker/routes/account';
import { api, env, finishOAuth, googleLogin, newUser, pairUp, startOAuth, uniqueEmail, uniqueSub, type TestUser } from './helpers';

const TODAY = isoDate(Date.now());
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);

async function photo(u: TestUser, kind: 'gym' | 'chat') {
  const form = new FormData();
  form.set('file', new File([JPEG], 'p.jpg'));
  form.set('kind', kind);
  form.set('date', TODAY);
  return (await api('POST', '/api/u/me/photos', { cookie: u.cookie, rawBody: form })).data.id as string;
}
async function planMedia(u: TestUser) {
  const form = new FormData();
  form.set('file', new File([JPEG], 'p.jpg'));
  return (await api('POST', '/api/u/partner/plan/media', { cookie: u.cookie, rawBody: form })).data.id as string;
}

/** Every (table, column) whose value equals `value`. */
async function referencesTo(value: string) {
  const { results: tables } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
  ).all<{ name: string }>();
  const hits: string[] = [];
  for (const { name } of tables) {
    const { results: cols } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${name}')`).all<{ name: string }>();
    for (const col of cols) {
      const row = await env.DB.prepare(`SELECT count(*) AS n FROM "${name}" WHERE "${col.name}" = ?`).bind(value).first<{ n: number }>();
      if (row!.n) hits.push(`${name}.${col.name} (${row!.n})`);
    }
  }
  return hits;
}

async function r2Keys(prefix: string) {
  return (await env.PHOTOS.list({ prefix })).objects.map((o) => o.key);
}

describe('account deletion', () => {
  it('requires the exact confirmation phrase and a session', async () => {
    const u = await newUser();
    expect((await api('DELETE', '/api/account', { body: { confirm: DELETE_CONFIRMATION } })).status).toBe(401);
    for (const confirm of ['', 'delete my account', 'yes']) {
      expect((await api('DELETE', '/api/account', { cookie: u.cookie, body: { confirm } })).status).toBe(400);
    }
    expect((await api('GET', '/api/auth/me', { cookie: u.cookie })).status).toBe(200);
  });

  it('removes every row and R2 object of the user, unpairs, ends sessions, and leaves the partner’s data', async () => {
    // A is a super user for these requests, so they can create an invite too.
    const aEmail = uniqueEmail('deleteme');
    const asSuper = { env: { SUPER_USER_EMAILS: aEmail } };
    const aSub = uniqueSub();
    const signup = await googleLogin({ sub: aSub, email: aEmail, name: 'Del' });
    expect(signup.location).toBe('/invite-only'); // not super without the override
    const reg = await finishOAuth(await startOAuth({}, asSuper), { sub: aSub, email: aEmail, name: 'Del' }, asSuper);
    const me = await api('GET', '/api/auth/me', { cookie: reg.cookie });
    const a: TestUser = { id: me.data.user.id, sub: aSub, email: aEmail, cookie: reg.cookie! };
    const secondSession = (await googleLogin({ sub: aSub, email: aEmail })).cookie!;

    // An invite A created, used by someone else.
    const invite = await api('POST', '/api/admin/invites', { cookie: a.cookie, body: {}, ...asSuper });
    const invitee = await googleLogin({ sub: uniqueSub(), email: uniqueEmail('invitee') }, { invite: invite.data.token });
    expect(invitee.cookie).toBeTruthy();

    const b = await newUser('Partner');
    await pairUp(a, b, 'couple');

    // Fill every table A can appear in.
    await api('PATCH', '/api/u/me/profile', { cookie: a.cookie, body: { heightCm: 170, targetWeightKg: 60, startWeightKg: 70 } });
    for (let i = 0; i < 7; i++) await api('PUT', `/api/u/me/weights/${addDays(TODAY, -i)}`, { cookie: a.cookie, body: { weightKg: 69 - i * 0.2 } });
    await api('PATCH', `/api/u/me/days/${TODAY}`, { cookie: a.cookie, body: { waterMl: 1000, caloriesBurned: 200 } });

    const mediaOnA = await planMedia(b); // B uploads to A's plan (owned by A)
    await api('PUT', '/api/u/partner/plan', {
      cookie: b.cookie,
      body: {
        calorieGoal: 'surplus', days: [{ weekday: 1, title: 'Push' }], stock: [{ label: 'Oats' }],
        meals: [{ name: 'Breakfast', itemList: [{ text: 'Oats' }] }],
        exercises: [{ weekday: new Date(TODAY).getUTCDay(), name: 'Squat', sets: 3, repsMin: 10, mediaIds: [mediaOnA] }],
      },
    });
    const mediaOnB = await planMedia(a); // A uploads to B's plan (owned by B)
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: { calorieGoal: 'deficit', meals: [], exercises: [{ weekday: 1, name: 'Row', mediaIds: [mediaOnB] }] } });

    const day = await api('GET', `/api/u/me/days/${TODAY}`, { cookie: a.cookie });
    await api('POST', `/api/u/me/days/${TODAY}/exercises`, { cookie: a.cookie, body: { planExerciseId: day.data.plannedExercises[0].id, sets: 3, reps: '10' } });
    await api('POST', `/api/u/me/days/${TODAY}/meals`, { cookie: a.cookie, body: { planMealId: day.data.plannedMeals[0].id, calories: 400 } });

    await photo(a, 'gym');
    const chatPhoto = await photo(a, 'chat');
    await api('POST', '/api/messages', { cookie: a.cookie, body: { body: 'hi', photoId: chatPhoto } });
    const fromB = await api('POST', '/api/messages', { cookie: b.cookie, body: { body: 'hey' } });
    await api('POST', '/api/messages/read', { cookie: a.cookie, body: { lastId: fromB.data.id } });
    const bPhoto = await photo(b, 'gym');

    await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'proud' } });
    await api('POST', '/api/nudges', { cookie: b.cookie, body: { kind: 'gym' } });
    await api('PUT', `/api/notes/${TODAY}`, { cookie: a.cookie, body: { body: 'from A' } });
    await api('PUT', `/api/notes/${TODAY}`, { cookie: b.cookie, body: { body: 'from B' } });
    const homeA = await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie }); // awards milestones
    expect(homeA.data.newMilestones.length).toBeGreaterThan(0);
    const homeB = await api('GET', `/api/home?date=${TODAY}`, { cookie: b.cookie });
    await api('POST', '/api/reactions', { cookie: b.cookie, body: { activityId: homeB.data.partnerActivity[0].id, emoji: '🔥' } });
    await api('POST', '/api/reactions', { cookie: a.cookie, body: { activityId: homeA.data.partnerActivity[0].id, emoji: '❤️' } });

    // Sanity: A really is everywhere before deletion.
    expect((await referencesTo(a.id)).length).toBeGreaterThan(15);
    expect((await r2Keys(`u/${a.id}/`)).length).toBe(2);
    expect((await r2Keys(`plan/${a.id}/`)).length).toBe(1);

    const del = await api('DELETE', '/api/account', { cookie: a.cookie, body: { confirm: DELETE_CONFIRMATION } });
    expect(del.status).toBe(200);
    expect(del.data.deletedObjects).toBe(3);
    expect(del.setCookies.some((c) => c.includes('Max-Age=0'))).toBe(true);

    // Nothing references A anywhere, by id or by email.
    expect(await referencesTo(a.id)).toEqual([]);
    expect(await referencesTo(a.email)).toEqual([]);
    expect(await referencesTo(a.sub)).toEqual([]);
    expect(await r2Keys(`u/${a.id}/`)).toEqual([]);
    expect(await r2Keys(`plan/${a.id}/`)).toEqual([]);

    // Every session is gone.
    expect((await api('GET', '/api/auth/me', { cookie: a.cookie })).status).toBe(401);
    expect((await api('GET', '/api/auth/me', { cookie: secondSession })).status).toBe(401);

    // The partner is unpaired but keeps their own data, including the photo A added to B's plan.
    const meB = await api('GET', '/api/auth/me', { cookie: b.cookie });
    expect(meB.data.pair).toBeNull();
    expect((await api('GET', `/api/photos/${bPhoto}`, { cookie: b.cookie })).status).toBe(200);
    const planB = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(planB.data.exercises[0].media.map((m: any) => m.id)).toEqual([mediaOnB]);
    expect(planB.data.plan.updatedByName).toBeNull();
    expect(await r2Keys(`plan/${b.id}/`)).toHaveLength(1);
    // The person A invited keeps their account.
    expect((await api('GET', '/api/auth/me', { cookie: invitee.cookie })).status).toBe(200);
  });

  it('the same Google account can only come back through a new invite', async () => {
    const u = await newUser('Gone');
    await api('DELETE', '/api/account', { cookie: u.cookie, body: { confirm: DELETE_CONFIRMATION } });
    expect((await googleLogin({ sub: u.sub, email: u.email })).location).toBe('/invite-only');
  });
});
