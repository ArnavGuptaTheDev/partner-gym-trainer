import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../functions/_lib/crypto';
import { LIMITS } from '../functions/_lib/ratelimit';
import { api, createInvite, env, newUser, PASSWORD, superCookie, uniqueEmail, uniqueIp } from './helpers';

describe('registration', () => {
  it('lets a SUPER_USER_EMAILS address register without an invite (case-insensitive)', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: { email: 'SECOND@example.com', password: PASSWORD, displayName: 'Second' },
    });
    expect(res.status).toBe(201);
    expect(res.data.user.isSuper).toBe(true);
    expect(res.data.user.email).toBe('second@example.com');
  });

  it('refuses regular emails without an invite', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'Nope' },
    });
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe('invite_required');
  });

  it('refuses a made-up invite token', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'Nope', inviteToken: 'not-a-real-token' },
    });
    expect(res.status).toBe(410);
  });

  it('accepts a valid invite exactly once', async () => {
    const { token } = await createInvite(await superCookie());
    const first = await api('POST', '/api/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'One', inviteToken: token },
    });
    expect(first.status).toBe(201);
    expect(first.data.user.isSuper).toBe(false);

    const second = await api('POST', '/api/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'Two', inviteToken: token },
    });
    expect(second.status).toBe(410);
  });

  it('refuses expired invites', async () => {
    const { id, token } = await createInvite(await superCookie());
    await env.DB.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    const res = await api('POST', '/api/auth/register', {
      body: { email: uniqueEmail(), password: PASSWORD, displayName: 'Late', inviteToken: token },
    });
    expect(res.status).toBe(410);
  });

  it('rejects duplicate emails', async () => {
    const user = await newUser();
    const { token } = await createInvite(await superCookie());
    const res = await api('POST', '/api/auth/register', {
      body: { email: user.email.toUpperCase(), password: PASSWORD, displayName: 'Dup', inviteToken: token },
    });
    expect(res.status).toBe(409);
  });

  it('validates the body and names the bad field', async () => {
    const res = await api('POST', '/api/auth/register', { body: { email: 'x@y.z', password: 'short', displayName: 'A' } });
    expect(res.status).toBe(400);
    expect(res.data.error.details.field).toBe('password');
  });

  it('stores PBKDF2 hashes with a per-user salt, never the password', async () => {
    const a = await newUser('A');
    const b = await newUser('B');
    const rows = await env.DB.prepare('SELECT pw_hash, pw_salt, pw_iter FROM users WHERE id IN (?, ?)')
      .bind(a.id, b.id)
      .all<{ pw_hash: string; pw_salt: string; pw_iter: number }>();
    expect(rows.results).toHaveLength(2);
    const [x, y] = rows.results;
    expect(x.pw_iter).toBe(100_000);
    expect(x.pw_salt).not.toBe(y.pw_salt);
    expect(x.pw_hash).not.toBe(y.pw_hash);
    expect(x.pw_hash).not.toContain(PASSWORD);
  });

  it('rate-limits registration per IP', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i <= LIMITS.register.max; i++) {
      last = (await api('POST', '/api/auth/register', { ip, body: { email: uniqueEmail(), password: PASSWORD, displayName: 'X' } })).status;
    }
    expect(last).toBe(429);
  });
});

describe('login and sessions', () => {
  it('sets an HttpOnly, Secure, SameSite=Lax session cookie and stores only its hash', async () => {
    const user = await newUser();
    const res = await api('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/Secure/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);

    const token = res.cookie!.split('=')[1];
    const raw = await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').bind(token).first();
    const hashed = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).first();
    expect(raw).toBeNull();
    expect(hashed).toEqual({ user_id: user.id });
  });

  it('rejects wrong passwords and unknown emails with the same error', async () => {
    const user = await newUser();
    const wrong = await api('POST', '/api/auth/login', { body: { email: user.email, password: 'wrong password!' } });
    const unknown = await api('POST', '/api/auth/login', { body: { email: uniqueEmail(), password: PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data.error).toEqual(unknown.data.error);
  });

  it('returns the current user from /api/auth/me and 401 without a session', async () => {
    const user = await newUser('Riya');
    const me = await api('GET', '/api/auth/me', { cookie: user.cookie });
    expect(me.status).toBe(200);
    expect(me.data.user).toMatchObject({ id: user.id, displayName: 'Riya', isSuper: false });
    expect((await api('GET', '/api/auth/me')).status).toBe(401);
    expect((await api('GET', '/api/auth/me', { cookie: 'spotter_session=forged' })).status).toBe(401);
  });

  it('logout invalidates the session server-side', async () => {
    const user = await newUser();
    const out = await api('POST', '/api/auth/logout', { cookie: user.cookie });
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await api('GET', '/api/auth/me', { cookie: user.cookie })).status).toBe(401);
  });

  it('expired sessions are rejected', async () => {
    const user = await newUser();
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(Date.now() - 1, user.id).run();
    expect((await api('GET', '/api/auth/me', { cookie: user.cookie })).status).toBe(401);
  });

  it('rate-limits login per IP', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i <= LIMITS.login.max; i++) {
      last = (await api('POST', '/api/auth/login', { ip, body: { email: uniqueEmail(), password: 'nope nope nope' } })).status;
    }
    expect(last).toBe(429);
    // A different IP is unaffected.
    expect((await api('POST', '/api/auth/login', { body: { email: uniqueEmail(), password: 'x' } })).status).toBe(401);
  });

  it('deactivation kills sessions and blocks login; reactivation restores it', async () => {
    const boss = await superCookie();
    const user = await newUser();
    expect((await api('POST', `/api/admin/users/${user.id}/deactivate`, { cookie: boss })).status).toBe(200);
    expect((await api('GET', '/api/auth/me', { cookie: user.cookie })).status).toBe(401);
    const login = await api('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } });
    expect(login.status).toBe(403);

    expect((await api('POST', `/api/admin/users/${user.id}/reactivate`, { cookie: boss })).status).toBe(200);
    expect((await api('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } })).status).toBe(200);
  });
});
