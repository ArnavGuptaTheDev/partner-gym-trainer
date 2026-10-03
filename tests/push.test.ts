import { describe, expect, it } from 'vitest';
import { b64url, fromB64url } from '../worker/crypto';
import { addDays, isoDate } from '../worker/dates';
import { deriveKeys, encryptPayload } from '../worker/push/encrypt';
import { isAllowedPushEndpoint } from '../worker/push/send';
import { SESSION_TTL_MS } from '../worker/session';
import { api, env, googleLogin, newPair, newUser, pushRequests, setPushStatus } from './helpers';
import { decrypt, enablePush, newDevice, received, subscribe } from './push-helpers';

const TODAY = isoDate(Date.now());
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
const mark = () => pushRequests.length;

// RFC 8291 §5 and Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function importPrivate(d: string, pub: string, usages: string[]) {
  const p = fromB64url(pub);
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d, x: b64url(p.slice(1, 33)), y: b64url(p.slice(33)) },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    usages,
  );
}

describe('RFC 8291 encryption', () => {
  it('derives the Appendix A intermediate values', async () => {
    const k = await deriveKeys(fromB64url(RFC.ecdh), fromB64url(RFC.auth), fromB64url(RFC.uaPublic), fromB64url(RFC.asPublic), fromB64url(RFC.salt));
    expect(b64url(k.ikm)).toBe(RFC.ikm);
    expect(b64url(k.cek)).toBe(RFC.cek);
    expect(b64url(k.nonce)).toBe(RFC.nonce);
  });

  it('reproduces the §5 example message byte for byte', async () => {
    const out = await encryptPayload(new TextEncoder().encode(RFC.plaintext), fromB64url(RFC.uaPublic), fromB64url(RFC.auth), {
      salt: fromB64url(RFC.salt),
      senderKeys: { privateKey: await importPrivate(RFC.asPrivate, RFC.asPublic, ['deriveBits']), publicRaw: fromB64url(RFC.asPublic) },
    });
    expect(b64url(out)).toBe(RFC.body);
  });

  it('the receiver side decrypts the example back to the plaintext', async () => {
    const device = {
      endpoint: '', keys: { p256dh: RFC.uaPublic, auth: RFC.auth },
      privateKey: await importPrivate(RFC.uaPrivate, RFC.uaPublic, ['deriveBits']),
      publicRaw: fromB64url(RFC.uaPublic), authSecret: fromB64url(RFC.auth),
    };
    expect(await decrypt(device, fromB64url(RFC.body))).toBe(RFC.plaintext);
  });

  it('rejects a browser key that is not on the P-256 curve', async () => {
    const bad = fromB64url(RFC.uaPublic);
    bad[40] ^= 0xff;
    await expect(encryptPayload(new Uint8Array([1]), bad, fromB64url(RFC.auth))).rejects.toThrow();
  });
});

describe('subscriptions', () => {
  it('subscribes, re-subscribes idempotently, and unsubscribes', async () => {
    const u = await newUser();
    const d = await newDevice();
    expect((await subscribe(u, d)).status).toBe(200);
    expect((await subscribe(u, d)).status).toBe(200);
    const rows = await env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE endpoint = ?').bind(d.endpoint).first();
    expect(rows).toEqual({ n: 1 });
    // First subscribe creates settings with everything on.
    const prefs = await api('GET', '/api/push/prefs', { cookie: u.cookie });
    expect(prefs.data).toMatchObject({ enabled: true, hidePreviews: false, types: { message: true, workout: true } });

    expect((await api('POST', '/api/push/unsubscribe', { cookie: u.cookie, body: { endpoint: d.endpoint } })).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').bind(d.endpoint).first()).toBeNull();
  });

  it('only accepts real push services and valid keys', async () => {
    const u = await newUser();
    const d = await newDevice();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/push', 'https://fcm.googleapis.com.evil.com/x', 'https://localhost/x', 'https://user:pw@fcm.googleapis.com/x']) {
      expect((await api('POST', '/api/push/subscribe', { cookie: u.cookie, body: { endpoint, keys: d.keys } })).status, endpoint).toBe(400);
    }
    expect((await api('POST', '/api/push/subscribe', { cookie: u.cookie, body: { endpoint: d.endpoint, keys: { ...d.keys, p256dh: b64url(new Uint8Array(65)) } } })).status).toBe(400);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
  });

  it('a second login plus page load leaves one working row on the new session', async () => {
    const { a, b } = await newPair();
    const d = await enablePush(b);
    // b signs in again on the same device (new session), and the app re-registers on load.
    const second = await googleLogin({ sub: b.sub, email: b.email });
    expect((await api('POST', '/api/push/subscribe', { cookie: second.cookie, body: { endpoint: d.endpoint, keys: d.keys } })).status).toBe(200);
    const rows = await env.DB.prepare('SELECT session_hash FROM push_subscriptions WHERE endpoint = ?').bind(d.endpoint).all();
    expect(rows.results).toHaveLength(1);

    // Ending the first session no longer affects this device.
    await api('POST', '/api/auth/logout', { cookie: b.cookie });
    const from = mark();
    await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'proud' } });
    expect(await received(d, from)).toHaveLength(1);
  });

  it('logout removes that device’s subscription', async () => {
    const u = await newUser();
    const d = await enablePush(u);
    await api('POST', '/api/auth/logout', { cookie: u.cookie });
    expect(await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').bind(d.endpoint).first()).toBeNull();
  });
});

describe('notifications', () => {
  it('a chat message notifies the partner (with preview), never the sender', async () => {
    const { a, b } = await newPair();
    const aDev = await enablePush(a);
    const bDev = await enablePush(b);
    const from = mark();
    await api('POST', '/api/messages', { cookie: a.cookie, body: { body: 'Leg day at 6?' } });
    const got = await received(bDev, from);
    expect(got).toEqual([{ title: 'Alex', body: 'Leg day at 6?', url: '/chat', tag: 'message', renotify: true }]);
    expect(await received(aDev, from)).toEqual([]);
    const req = pushRequests.find((r) => r.endpoint === bDev.endpoint)!;
    expect(req.headers.get('content-encoding')).toBe('aes128gcm');
    expect(req.headers.get('urgency')).toBe('high');
    expect(req.headers.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  });

  it('hides message text when previews are hidden, and says "sent a photo" for photos', async () => {
    const { a, b } = await newPair();
    const bDev = await enablePush(b);
    let from = mark();
    const form = new FormData();
    form.set('file', new File([JPEG], 'p.jpg'));
    form.set('kind', 'chat');
    form.set('date', TODAY);
    const photo = await api('POST', '/api/u/me/photos', { cookie: a.cookie, rawBody: form });
    await api('POST', '/api/messages', { cookie: a.cookie, body: { photoId: photo.data.id } });
    expect((await received(bDev, from))[0].body).toBe('sent a photo 📷');

    await api('PUT', '/api/push/prefs', { cookie: b.cookie, body: { hidePreviews: true } });
    from = mark();
    await api('POST', '/api/messages', { cookie: a.cookie, body: { body: 'secret plans' } });
    expect((await received(bDev, from))[0].body).toBe('sent you a message');
  });

  it('respects per-type toggles and the master toggle', async () => {
    const { a, b } = await newPair();
    const bDev = await enablePush(b);
    await api('PUT', '/api/push/prefs', { cookie: b.cookie, body: { nudge: false } });
    let from = mark();
    await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'gym' } });
    await api('PUT', `/api/notes/${TODAY}`, { cookie: a.cookie, body: { body: 'You got this' } });
    expect((await received(bDev, from)).map((n) => n.tag)).toEqual(['note']);

    await api('PUT', '/api/push/prefs', { cookie: b.cookie, body: { enabled: false } });
    from = mark();
    await api('POST', '/api/messages', { cookie: a.cookie, body: { body: 'hi' } });
    expect(await received(bDev, from)).toEqual([]);
  });

  it('sends gym photo, plan, note, nudge and milestone notifications without numbers', async () => {
    const { a, b } = await newPair();
    const bDev = await enablePush(b);
    const from = mark();
    const form = new FormData();
    form.set('file', new File([JPEG], 'p.jpg'));
    form.set('kind', 'gym');
    form.set('date', TODAY);
    await api('POST', '/api/u/me/photos', { cookie: a.cookie, rawBody: form });
    await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: { calorieGoal: 'deficit', calorieTarget: 1800, meals: [], exercises: [] } });
    await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'proud' } });
    // A weight milestone for a (lost 2 kg toward an 8 kg goal).
    await api('PATCH', '/api/u/me/profile', { cookie: a.cookie, body: { startWeightKg: 88, targetWeightKg: 80 } });
    await api('PUT', `/api/u/me/weights/${TODAY}`, { cookie: a.cookie, body: { weightKg: 86 } });
    await api('GET', `/api/home?date=${TODAY}`, { cookie: a.cookie });

    const got = await received(bDev, from);
    expect(got.map((n) => n.tag)).toEqual(['photo', 'plan', 'nudge', 'milestone']);
    expect(got.find((n) => n.tag === 'plan')!.body).toBe('updated your plan ✍️');
    expect(got.find((n) => n.tag === 'milestone')!.body).toBe('hit a milestone: a weight milestone 🏆');
    for (const n of got) expect(`${n.title} ${n.body}`, n.body).not.toMatch(/\d|kg|kcal|lb/i);
  });

  it('sends "finished their workout" once per day when every planned exercise is done', async () => {
    const { a, b } = await newPair();
    const bDev = await enablePush(b);
    const wd = new Date(`${TODAY}T00:00:00Z`).getUTCDay();
    await api('PUT', '/api/u/partner/plan', {
      cookie: b.cookie,
      body: { calorieGoal: 'maintain', meals: [], exercises: [{ weekday: wd, name: 'Squat', sets: 3, repsMin: 5 }, { weekday: wd, name: 'Row', sets: 3, repsMin: 8 }] },
    });
    const day = await api('GET', `/api/u/me/days/${TODAY}`, { cookie: a.cookie });
    const [sq, row] = day.data.plannedExercises;
    const from = mark();
    await api('POST', `/api/u/me/days/${TODAY}/exercises`, { cookie: a.cookie, body: { planExerciseId: sq.id } });
    expect(await received(bDev, from)).toEqual([]); // 1 of 2
    const log = await api('POST', `/api/u/me/days/${TODAY}/exercises`, { cookie: a.cookie, body: { planExerciseId: row.id } });
    expect((await received(bDev, from)).map((n) => n.body)).toEqual(['finished their workout 💪']);

    // Unchecking and re-checking doesn't buzz again.
    await api('PATCH', `/api/u/me/exercises/${log.data.id}`, { cookie: a.cookie, body: { done: false } });
    await api('PATCH', `/api/u/me/exercises/${log.data.id}`, { cookie: a.cookie, body: { done: true } });
    expect(await received(bDev, from)).toHaveLength(1);

    // Backfilling last week's same weekday completes that day but doesn't notify.
    const old = addDays(TODAY, -7);
    const before = mark();
    await api('POST', `/api/u/me/days/${old}/exercises`, { cookie: a.cookie, body: { planExerciseId: sq.id } });
    await api('POST', `/api/u/me/days/${old}/exercises`, { cookie: a.cookie, body: { planExerciseId: row.id } });
    expect(await received(bDev, before)).toEqual([]);
  });

  it('an unpaired user triggers nothing', async () => {
    const solo = await newUser();
    await enablePush(solo);
    const from = mark();
    await api('PUT', `/api/u/me/plan`, { cookie: solo.cookie, body: { calorieGoal: 'maintain', meals: [], exercises: [] } });
    const form = new FormData();
    form.set('file', new File([JPEG], 'p.jpg'));
    form.set('kind', 'gym');
    form.set('date', TODAY);
    await api('POST', '/api/u/me/photos', { cookie: solo.cookie, rawBody: form });
    expect(pushRequests.length).toBe(from);
  });

  it('prunes subscriptions the push service says are gone (404/410), keeps others', async () => {
    const { a, b } = await newPair();
    const gone = await enablePush(b);
    const missing = await newDevice();
    const flaky = await newDevice();
    await subscribe(b, missing);
    await subscribe(b, flaky);
    setPushStatus(gone.endpoint, 410);
    setPushStatus(missing.endpoint, 404);
    setPushStatus(flaky.endpoint, 500);
    await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'gym' } });
    const left = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?').bind(b.id).all<{ endpoint: string }>();
    expect(left.results.map((r) => r.endpoint)).toEqual([flaky.endpoint]);
  });

  it('a push failure never fails the triggering request', async () => {
    const { a, b } = await newPair();
    const d = await enablePush(b);
    setPushStatus(d.endpoint, 500);
    expect((await api('POST', '/api/messages', { cookie: a.cookie, body: { body: 'still sends' } })).status).toBe(201);
  });

  it('skips devices whose session has expired', async () => {
    const { a, b } = await newPair();
    const d = await enablePush(b);
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(Date.now() - 1, b.id).run();
    const from = mark();
    await api('POST', '/api/nudges', { cookie: a.cookie, body: { kind: 'proud' } });
    expect(await received(d, from)).toEqual([]);
    // ...and its subscription is removed, as the privacy page says.
    expect(await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').bind(d.endpoint).first()).toBeNull();
  });

  it('"send me a test" goes to your own devices', async () => {
    const u = await newUser();
    const d = await enablePush(u);
    const from = mark();
    const res = await api('POST', '/api/push/test', { cookie: u.cookie });
    expect(res.data).toEqual({ devices: 1, delivered: 1 });
    expect((await received(d, from))[0]).toMatchObject({ tag: 'test', body: 'Notifications are working 🎉' });
  });

  it('does nothing (and fails nothing) when VAPID keys are not configured', async () => {
    const { a, b } = await newPair();
    await enablePush(b);
    const from = mark();
    const res = await api('POST', '/api/messages', { cookie: a.cookie, body: { body: 'hi' }, env: { VAPID_PRIVATE_KEY: '' } });
    expect(res.status).toBe(201);
    expect(pushRequests.length).toBe(from);
    expect((await api('GET', '/api/push/config', { cookie: a.cookie, env: { VAPID_PRIVATE_KEY: '' } })).data.publicKey).toBeNull();
  });
});

describe('session lifetime (push depends on it)', () => {
  it('slides to 30 days after the last use, writing at most once a day', async () => {
    const u = await newUser();
    const nearlyExpired = Date.now() + 2 * 86_400_000;
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(nearlyExpired, u.id).run();
    await api('GET', '/api/auth/me', { cookie: u.cookie });
    const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE user_id = ?').bind(u.id).first<{ expires_at: number }>();
    expect(row!.expires_at).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 60_000);

    // Used again within the day: no write.
    const before = row!.expires_at;
    await api('GET', '/api/auth/me', { cookie: u.cookie });
    const again = await env.DB.prepare('SELECT expires_at FROM sessions WHERE user_id = ?').bind(u.id).first<{ expires_at: number }>();
    expect(again!.expires_at).toBe(before);
  });
});
