import { describe, expect, it } from 'vitest';
import { api, createInvite, googleLogin, newUser, superCookie, uniqueEmail, uniqueSub } from './helpers';

describe('invite management', () => {
  it('requires a super user', async () => {
    const user = await newUser();
    expect((await api('POST', '/api/admin/invites', { body: {} })).status).toBe(401);
    expect((await api('POST', '/api/admin/invites', { cookie: user.cookie, body: {} })).status).toBe(403);
    expect((await api('GET', '/api/admin/invites', { cookie: user.cookie })).status).toBe(403);
    expect((await api('GET', '/api/admin/users', { cookie: user.cookie })).status).toBe(403);
    expect((await api('POST', `/api/admin/users/${user.id}/deactivate`, { cookie: user.cookie })).status).toBe(403);
  });

  it('creates a 7-day link and reports its validity publicly', async () => {
    const boss = await superCookie();
    const res = await api('POST', '/api/admin/invites', { cookie: boss, body: { note: 'for Alex' } });
    expect(res.status).toBe(201);
    expect(res.data.url).toContain(`/join?invite=${res.data.token}`);
    const days = (res.data.expiresAt - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);

    const check = await api('GET', `/api/invites/${res.data.token}`);
    expect(check.data.valid).toBe(true);
    expect((await api('GET', '/api/invites/bogus')).data.valid).toBe(false);
  });

  it('lists invites with status and who used them', async () => {
    const boss = await superCookie();
    const used = await createInvite(boss, 'used one');
    const email = uniqueEmail('jo');
    await googleLogin({ sub: uniqueSub(), email, name: 'Jo' }, { invite: used.token });
    const active = await createInvite(boss, 'active one');

    const list = await api('GET', '/api/admin/invites?limit=50', { cookie: boss });
    const byId = Object.fromEntries(list.data.items.map((i: any) => [i.id, i]));
    expect(byId[used.id].status).toBe('used');
    expect(byId[used.id].usedBy).toMatchObject({ displayName: 'Jo', email });
    expect(byId[active.id].status).toBe('active');
    expect(byId[active.id].usedBy).toBeNull();
    // Raw tokens are never listed.
    expect(JSON.stringify(list.data)).not.toContain(active.token);
  });

  it('revokes unused invites, which then stop working', async () => {
    const boss = await superCookie();
    const inv = await createInvite(boss);
    expect((await api('DELETE', `/api/admin/invites/${inv.id}`, { cookie: boss })).status).toBe(200);
    expect((await api('GET', `/api/invites/${inv.token}`)).data.valid).toBe(false);
    const signup = await googleLogin({ sub: uniqueSub(), email: uniqueEmail() }, { invite: inv.token });
    expect(signup.location).toBe('/invite-only');
    expect((await api('DELETE', `/api/admin/invites/${inv.id}`, { cookie: boss })).status).toBe(409);
    expect((await api('DELETE', '/api/admin/invites/nope', { cookie: boss })).status).toBe(404);
  });

  it('cannot revoke an invite that has been used', async () => {
    const boss = await superCookie();
    const inv = await createInvite(boss);
    await googleLogin({ sub: uniqueSub(), email: uniqueEmail() }, { invite: inv.token });
    expect((await api('DELETE', `/api/admin/invites/${inv.id}`, { cookie: boss })).status).toBe(409);
  });

  it('paginates the invite list with a cursor', async () => {
    const boss = await superCookie();
    for (let i = 0; i < 3; i++) await createInvite(boss);
    const first = await api('GET', '/api/admin/invites?limit=2', { cookie: boss });
    expect(first.data.items).toHaveLength(2);
    expect(first.data.nextCursor).toBeTruthy();
    const second = await api('GET', `/api/admin/invites?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`, { cookie: boss });
    const ids = new Set(first.data.items.map((i: any) => i.id));
    for (const item of second.data.items) expect(ids.has(item.id)).toBe(false);
  });

  it('super users cannot deactivate themselves', async () => {
    const boss = await superCookie();
    const me = await api('GET', '/api/auth/me', { cookie: boss });
    expect((await api('POST', `/api/admin/users/${me.data.user.id}/deactivate`, { cookie: boss })).status).toBe(400);
  });
});
