import { describe, expect, it } from 'vitest';
import { LIMITS } from '../worker/ratelimit';
import { api, env, newPair, newUser, pairUp, uniqueIp } from './helpers';

describe('pairing', () => {
  it('pairs two users with a code and shows each the other', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Ben');
    const code = await api('POST', '/api/pair/code', { cookie: a.cookie, body: { pairType: 'couple' } });
    expect(code.status).toBe(201);
    expect(code.data.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await api('GET', '/api/pair', { cookie: a.cookie })).data.code.code).toBe(code.data.code);

    // Codes are case- and separator-insensitive.
    const pretty = `${code.data.code.slice(0, 4)}-${code.data.code.slice(4)}`.toLowerCase();
    const join = await api('POST', '/api/pair/join', { cookie: b.cookie, body: { code: pretty } });
    expect(join.status).toBe(201);

    const meA = await api('GET', '/api/auth/me', { cookie: a.cookie });
    const meB = await api('GET', '/api/auth/me', { cookie: b.cookie });
    expect(meA.data.pair).toMatchObject({ type: 'couple', partner: { id: b.id, displayName: 'Ben' } });
    expect(meB.data.pair).toMatchObject({ type: 'couple', partner: { id: a.id, displayName: 'Ana' } });
    // The code is consumed.
    expect((await api('GET', '/api/pair', { cookie: a.cookie })).data.code).toBeNull();
  });

  it('refuses your own code', async () => {
    const a = await newUser();
    const code = await api('POST', '/api/pair/code', { cookie: a.cookie, body: { pairType: 'friends' } });
    const res = await api('POST', '/api/pair/join', { cookie: a.cookie, body: { code: code.data.code } });
    expect(res.status).toBe(409);
  });

  it('refuses unknown and expired codes', async () => {
    const a = await newUser();
    const b = await newUser();
    expect((await api('POST', '/api/pair/join', { cookie: b.cookie, body: { code: 'ZZZZZZZZ' } })).status).toBe(404);
    const code = await api('POST', '/api/pair/code', { cookie: a.cookie, body: { pairType: 'friends' } });
    await env.DB.prepare('UPDATE pairing_codes SET expires_at = ? WHERE user_id = ?').bind(Date.now() - 1, a.id).run();
    expect((await api('POST', '/api/pair/join', { cookie: b.cookie, body: { code: code.data.code } })).status).toBe(404);
  });

  it('is strictly one-to-one: no second partner from either side', async () => {
    const { a, b } = await newPair();
    const c = await newUser('Cleo');
    expect((await api('POST', '/api/pair/code', { cookie: a.cookie, body: { pairType: 'friends' } })).status).toBe(409);
    const cCode = await api('POST', '/api/pair/code', { cookie: c.cookie, body: { pairType: 'friends' } });
    expect((await api('POST', '/api/pair/join', { cookie: b.cookie, body: { code: cCode.data.code } })).status).toBe(409);
  });

  it('clears stale codes when their owner pairs with someone else', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const aCode = await api('POST', '/api/pair/code', { cookie: a.cookie, body: { pairType: 'friends' } });
    await pairUp(b, a); // a joins b's code instead
    const res = await api('POST', '/api/pair/join', { cookie: c.cookie, body: { code: aCode.data.code } });
    expect(res.status).toBe(404);
  });

  it('enforces one pair per user in the schema itself', async () => {
    const { a, b } = await newPair();
    const c = await newUser();
    const insert = (x: string, y: string) =>
      env.DB.prepare('INSERT INTO pairs (id, user_a_id, user_b_id, pair_type, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), x, y, 'friends', Date.now())
        .run();
    // Same-column (UNIQUE), cross-column (trigger) and self-pairs all fail.
    await expect(insert(a.id, c.id)).rejects.toThrow();
    await expect(insert(c.id, a.id)).rejects.toThrow();
    await expect(insert(c.id, b.id)).rejects.toThrow();
    await expect(insert(c.id, c.id)).rejects.toThrow();
    await expect(env.DB.prepare('UPDATE pairs SET user_b_id = ? WHERE user_a_id = ?').bind(c.id, a.id).run()).rejects.toThrow();
  });

  it('lets either user unpair; both lose the link and can pair again', async () => {
    const { a, b } = await newPair();
    expect((await api('DELETE', '/api/pair', { cookie: b.cookie })).status).toBe(200);
    expect((await api('GET', '/api/auth/me', { cookie: a.cookie })).data.pair).toBeNull();
    expect((await api('GET', '/api/auth/me', { cookie: b.cookie })).data.pair).toBeNull();
    expect((await api('DELETE', '/api/pair', { cookie: a.cookie })).status).toBe(404);

    const c = await newUser();
    await pairUp(a, c);
    expect((await api('GET', '/api/auth/me', { cookie: c.cookie })).data.pair.partner.id).toBe(a.id);
  });

  it('updates pair settings for both partners', async () => {
    const { a, b } = await newPair('friends');
    const res = await api('PATCH', '/api/pair', {
      cookie: b.cookie,
      body: { pairType: 'couple', allowSelfEdit: true, togetherSince: '2022-02-14' },
    });
    expect(res.status).toBe(200);
    const me = await api('GET', '/api/pair', { cookie: a.cookie });
    expect(me.data.pair).toMatchObject({ type: 'couple', allowSelfEdit: true, togetherSince: '2022-02-14' });

    await api('PATCH', '/api/pair', { cookie: a.cookie, body: { togetherSince: null } });
    expect((await api('GET', '/api/pair', { cookie: a.cookie })).data.pair).toMatchObject({ togetherSince: null, allowSelfEdit: true });
    expect((await api('PATCH', '/api/pair', { cookie: a.cookie, body: { pairType: 'group' } })).status).toBe(400);
  });

  it('rate-limits code guessing per IP', async () => {
    const b = await newUser();
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i <= LIMITS.pairJoin.max; i++) {
      last = (await api('POST', '/api/pair/join', { ip, cookie: b.cookie, body: { code: 'AAAAAAAA' } })).status;
    }
    expect(last).toBe(429);
  });
});
