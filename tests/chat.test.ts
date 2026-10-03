import { describe, expect, it } from 'vitest';
import { api, env, newPair, newUser, pairUp, type TestUser } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);

async function photo(user: TestUser, kind: 'chat' | 'gym') {
  const form = new FormData();
  form.set('file', new File([JPEG], 'p.jpg'));
  form.set('kind', kind);
  form.set('date', '2026-06-01');
  return (await api('POST', '/api/u/me/photos', { cookie: user.cookie, rawBody: form })).data.id as string;
}

const send = (u: TestUser, body: unknown) => api('POST', '/api/messages', { cookie: u.cookie, body });

describe('chat', () => {
  it('needs a partner', async () => {
    const solo = await newUser();
    expect((await api('GET', '/api/messages', { cookie: solo.cookie })).status).toBe(404);
    expect((await send(solo, { body: 'hi' })).status).toBe(404);
    expect((await api('GET', '/api/pulse', { cookie: solo.cookie })).data).toEqual({ unread: 0, nudges: [] });
  });

  it('delivers messages and supports polling with ?after', async () => {
    const { a, b } = await newPair();
    const m1 = await send(a, { body: 'Leg day? 🦵' });
    expect(m1.status).toBe(201);
    expect(m1.data).toMatchObject({ senderId: a.id, body: 'Leg day? 🦵', photoUrl: null });

    const latest = await api('GET', '/api/messages', { cookie: b.cookie });
    expect(latest.data.items.map((m: any) => m.body)).toEqual(['Leg day? 🦵']);

    const m2 = await send(b, { body: 'always' });
    const poll = await api('GET', `/api/messages?after=${m1.data.id}`, { cookie: a.cookie });
    expect(poll.data.items.map((m: any) => m.id)).toEqual([m2.data.id]);
    expect((await api('GET', `/api/messages?after=${m2.data.id}`, { cookie: a.cookie })).data.items).toEqual([]);
  });

  it('pages back through history with ?before, oldest first', async () => {
    const { a, b } = await newPair();
    for (let i = 1; i <= 5; i++) await send(i % 2 ? a : b, { body: `m${i}` });
    const p1 = await api('GET', '/api/messages?limit=2', { cookie: a.cookie });
    expect(p1.data.items.map((m: any) => m.body)).toEqual(['m4', 'm5']);
    expect(p1.data.hasMore).toBe(true);
    const p2 = await api('GET', `/api/messages?limit=2&before=${p1.data.items[0].id}`, { cookie: a.cookie });
    expect(p2.data.items.map((m: any) => m.body)).toEqual(['m2', 'm3']);
  });

  it('tracks unread counts and read receipts', async () => {
    const { a, b } = await newPair();
    await send(a, { body: 'one' });
    const two = await send(a, { body: 'two' });
    expect((await api('GET', '/api/pulse', { cookie: b.cookie })).data.unread).toBe(2);
    expect((await api('GET', '/api/pulse', { cookie: a.cookie })).data.unread).toBe(0);

    await api('POST', '/api/messages/read', { cookie: b.cookie, body: { lastId: two.data.id } });
    expect((await api('GET', '/api/pulse', { cookie: b.cookie })).data.unread).toBe(0);
    expect((await api('GET', '/api/messages', { cookie: a.cookie })).data.partnerLastReadId).toBe(two.data.id);

    // Read markers never move backwards.
    await api('POST', '/api/messages/read', { cookie: b.cookie, body: { lastId: 0 } });
    expect((await api('GET', '/api/pulse', { cookie: b.cookie })).data.unread).toBe(0);
  });

  it('attaches only your own chat photos; the partner can view them', async () => {
    const { a, b } = await newPair();
    const mine = await photo(a, 'chat');
    const gym = await photo(a, 'gym');
    const theirs = await photo(b, 'chat');

    const ok = await send(a, { photoId: mine });
    expect(ok.status).toBe(201);
    expect((await api('GET', ok.data.photoUrl, { cookie: b.cookie })).status).toBe(200);
    expect((await send(a, { photoId: gym })).status).toBe(400);
    expect((await send(a, { photoId: theirs })).status).toBe(400);
  });

  it('validates bodies', async () => {
    const { a } = await newPair();
    expect((await send(a, {})).status).toBe(400);
    expect((await send(a, { body: '   ' })).status).toBe(400);
    expect((await send(a, { body: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('chat history goes away on unpair and never leaks into a new pair', async () => {
    const { a, b, pairId } = await newPair();
    await send(a, { body: 'secret' });
    await api('DELETE', '/api/pair', { cookie: b.cookie });
    const left = await env.DB.prepare('SELECT count(*) AS n FROM messages WHERE pair_id = ?').bind(pairId).first();
    expect(left).toEqual({ n: 0 });

    const c = await newUser();
    await pairUp(b, c);
    expect((await api('GET', '/api/messages', { cookie: b.cookie })).data.items).toEqual([]);
  });
});
