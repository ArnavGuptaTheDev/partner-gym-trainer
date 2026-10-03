import { describe, expect, it } from 'vitest';
import { pkceChallenge, sha256Hex } from '../worker/crypto';
import { safeNext, verifyIdTokenClaims } from '../worker/oauth';
import { LIMITS } from '../worker/ratelimit';
import {
  api,
  BASE,
  CLIENT_ID,
  createInvite,
  env,
  failNextTokenExchange,
  finishOAuth,
  googleLogin,
  newUser,
  startOAuth,
  superCookie,
  tokenRequests,
  uniqueEmail,
  uniqueIp,
  uniqueSub,
} from './helpers';

const userBySub = (sub: string) => env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(sub).first<any>();
const stranger = () => ({ sub: uniqueSub(), email: uniqueEmail('new') });

describe('safeNext', () => {
  it('keeps same-origin relative paths', () => {
    for (const ok of ['/', '/plan', '/log?date=2026-01-01&who=partner', '/photos#top']) expect(safeNext(ok)).toBe(ok);
  });
  it('falls back to / for anything that could leave the site', () => {
    const bad = [
      null, '', 'plan', '//evil.com', '//evil.com/path', '/\\evil.com', '\\\\evil.com', '/\\/evil.com',
      'https://evil.com', 'http:/evil.com', 'javascript:alert(1)', ' /plan', '/\t/evil.com', '/\n/evil.com',
    ];
    for (const raw of bad) expect(safeNext(raw), String(raw)).toBe('/');
  });
});

describe('ID token claim checks (unit)', () => {
  const base = { iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: 2e9, nonce: 'n', sub: 's', email: 'A@B.co', email_verified: true };
  it('accepts valid claims and normalises email', () => {
    expect(verifyIdTokenClaims(base, CLIENT_ID, 'n', Date.now())).toMatchObject({ sub: 's', email: 'a@b.co' });
    expect(() => verifyIdTokenClaims({ ...base, iss: 'accounts.google.com' }, CLIENT_ID, 'n', Date.now())).not.toThrow();
  });
  it.each([
    ['wrong aud', { aud: 'someone-else' }, 'token'],
    ['multi aud', { aud: [CLIENT_ID, 'other'] }, 'token'],
    ['wrong iss', { iss: 'https://evil.example' }, 'token'],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 1 }, 'token'],
    ['nonce mismatch', { nonce: 'x' }, 'token'],
    ['missing sub', { sub: '' }, 'token'],
    ['unverified email', { email_verified: false }, 'unverified'],
    ['stringly verified', { email_verified: 'true' }, 'unverified'],
  ])('rejects %s', (_, over, code) => {
    expect(() => verifyIdTokenClaims({ ...base, ...over }, CLIENT_ID, 'n', Date.now())).toThrow(code);
  });
});

describe('GET /api/auth/google/start', () => {
  it('redirects to Google with PKCE (S256), state, nonce and the right scopes', async () => {
    const flow = await startOAuth({ next: '/plan' });
    const p = flow.googleUrl.searchParams;
    expect(flow.googleUrl.origin + flow.googleUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(p.get('client_id')).toBe(CLIENT_ID);
    expect(p.get('redirect_uri')).toBe(`${BASE}/api/auth/google/callback`);
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(flow.state.length).toBeGreaterThanOrEqual(43);

    const cookie = flow.start.setCookies.find((c) => c.startsWith('spotter_oauth='))!;
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600', 'Path=/api/auth/google']) expect(cookie).toContain(attr);
    // Nothing secret leaks into Google's URL.
    expect(flow.googleUrl.toString()).not.toContain('verifier');
  });

  it('sends the PKCE verifier matching the challenge to the token endpoint', async () => {
    const flow = await startOAuth();
    const before = tokenRequests.length;
    await finishOAuth(flow, stranger());
    const req = tokenRequests[before];
    expect(req.get('grant_type')).toBe('authorization_code');
    expect(req.get('client_secret')).toBe('test-secret');
    expect(req.get('redirect_uri')).toBe(`${BASE}/api/auth/google/callback`);
    expect(await pkceChallenge(req.get('code_verifier')!)).toBe(flow.challenge);
  });

  it('is rate-limited per IP', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i <= LIMITS.oauthStart.max; i++) last = (await api('GET', '/api/auth/google/start', { ip })).status;
    expect(last).toBe(429);
  });
});

describe('GET /api/auth/google/callback', () => {
  it('rejects a state mismatch and a missing cookie without calling Google', async () => {
    const flow = await startOAuth();
    const before = tokenRequests.length;
    const { who, opts } = wouldBeSuper();
    const bad = await finishOAuth(flow, who, { ...opts, state: 'forged' });
    expect(bad.location).toBe('/login?error=state');
    expect(bad.cookie).toBeUndefined();
    expect(bad.setCookies.some((c) => c.startsWith('spotter_oauth=;') && c.includes('Max-Age=0'))).toBe(true);

    const noCookie = await api('GET', `/api/auth/google/callback?code=x&state=${flow.state}`, opts);
    expect(noCookie.location).toBe('/login?error=state');
    expect(tokenRequests.length).toBe(before);
    expect(await userBySub(who.sub)).toBeNull();
  });

  it('rejects unverified email and creates nothing', async () => {
    const { who: base, opts } = wouldBeSuper();
    const who = { ...base, claims: { email_verified: false } };
    const res = await finishOAuth(await startOAuth(), who, opts);
    expect(res.location).toBe('/login?error=unverified');
    expect(res.cookie).toBeUndefined();
    expect(await userBySub(who.sub)).toBeNull();
  });

  it('rejects an ID token for a different client (aud)', async () => {
    const { who: base, opts } = wouldBeSuper();
    const who = { ...base, claims: { aud: 'other-client.apps.googleusercontent.com' } };
    const res = await finishOAuth(await startOAuth(), who, opts);
    expect(res.location).toBe('/login?error=token');
    expect(await userBySub(who.sub)).toBeNull();
  });

  it('handles token endpoint failures and user cancellation', async () => {
    const flow = await startOAuth();
    failNextTokenExchange(400);
    expect((await finishOAuth(flow, stranger())).location).toBe('/login?error=google');
    const cancelled = await api('GET', '/api/auth/google/callback?error=access_denied', { cookie: flow.oauthCookie });
    expect(cancelled.location).toBe('/login?error=cancelled');
  });

  it('sends a new user without an invite to /invite-only and creates nothing', async () => {
    const who = stranger();
    const res = await googleLogin(who);
    expect(res.location).toBe('/invite-only');
    expect(res.cookie).toBeUndefined();
    expect(await userBySub(who.sub)).toBeNull();
    // A made-up invite token is no better.
    expect((await googleLogin(stranger(), { invite: 'not-a-real-invite' })).location).toBe('/invite-only');
  });

  it('bootstraps a super user from SUPER_USER_EMAILS without an invite (case-insensitive)', async () => {
    const who = { sub: uniqueSub(), email: 'SECOND@example.com', name: 'Second Boss' };
    const res = await googleLogin(who);
    expect(res.location).toBe('/');
    const me = await api('GET', '/api/auth/me', { cookie: res.cookie });
    expect(me.data.user).toMatchObject({ email: 'second@example.com', displayName: 'Second Boss', isSuper: true });

    // Control for the rejection tests: wouldBeSuper() identities do get in.
    const { who: fresh, opts } = wouldBeSuper();
    expect((await finishOAuth(await startOAuth(), fresh, opts)).cookie).toBeTruthy();
  });

  it('consumes an invite exactly once', async () => {
    const { id, token } = await createInvite(await superCookie());
    const first = stranger();
    const res = await googleLogin({ ...first, name: 'Jo' }, { invite: token, next: '/settings?welcome=1' });
    expect(res.location).toBe('/settings?welcome=1');
    const user = await userBySub(first.sub);
    expect(user).toMatchObject({ email: first.email, display_name: 'Jo', google_name: 'Jo', invite_id: id });
    const inv = await env.DB.prepare('SELECT used_by FROM invites WHERE id = ?').bind(id).first();
    expect(inv).toEqual({ used_by: user.id });

    const second = stranger();
    expect((await googleLogin(second, { invite: token })).location).toBe('/invite-only');
    expect(await userBySub(second.sub)).toBeNull();
  });

  it('lets only one of two concurrent callbacks use an invite', async () => {
    const { id, token } = await createInvite(await superCookie());
    const [f1, f2] = await Promise.all([startOAuth({ invite: token }), startOAuth({ invite: token })]);
    const [u1, u2] = [stranger(), stranger()];
    const results = await Promise.all([finishOAuth(f1, u1), finishOAuth(f2, u2)]);

    const winners = results.filter((r) => r.cookie);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.location === '/invite-only')).toHaveLength(1);
    const created = [await userBySub(u1.sub), await userBySub(u2.sub)].filter(Boolean);
    expect(created).toHaveLength(1);
    const inv = await env.DB.prepare('SELECT used_by FROM invites WHERE id = ?').bind(id).first();
    expect(inv).toEqual({ used_by: created[0].id });
  });

  it('logs an existing user in by sub and refreshes Google name, avatar and email (not display name)', async () => {
    const user = await newUser('Riya');
    await api('PATCH', '/api/u/me/profile', { cookie: user.cookie, body: { displayName: 'Riri' } });
    const newEmail = uniqueEmail('riya.new');
    // No invite needed the second time: the sub already has an account.
    const res = await googleLogin({ sub: user.sub, email: newEmail, name: 'Riya Sharma', picture: 'https://lh3.googleusercontent.com/a/new' });
    expect(res.location).toBe('/');
    const me = await api('GET', '/api/auth/me', { cookie: res.cookie });
    expect(me.data.user).toMatchObject({ id: user.id, displayName: 'Riri', email: newEmail, avatarUrl: 'https://lh3.googleusercontent.com/a/new' });
    expect((await userBySub(user.sub)).google_name).toBe('Riya Sharma');
  });

  it('never matches by email: a different sub with a known email is not that user', async () => {
    const user = await newUser('Kim');
    const imposter = await googleLogin({ sub: uniqueSub(), email: user.email });
    expect(imposter.location).toBe('/invite-only');
    expect(imposter.cookie).toBeUndefined();
    // Even with a valid invite, it cannot take over or duplicate the email.
    const { token } = await createInvite(await superCookie());
    expect((await googleLogin({ sub: uniqueSub(), email: user.email }, { invite: token })).location).toBe('/login?error=email_taken');
  });

  it('refuses deactivated accounts at the callback', async () => {
    const boss = await superCookie();
    const user = await newUser();
    await api('POST', `/api/admin/users/${user.id}/deactivate`, { cookie: boss });
    expect((await api('GET', '/api/auth/me', { cookie: user.cookie })).status).toBe(401); // sessions killed
    const res = await googleLogin({ sub: user.sub, email: user.email });
    expect(res.location).toBe('/login?error=deactivated');
    expect(res.cookie).toBeUndefined();

    await api('POST', `/api/admin/users/${user.id}/reactivate`, { cookie: boss });
    expect((await googleLogin({ sub: user.sub, email: user.email })).cookie).toBeTruthy();
  });

  it('honours a safe ?next and ignores an unsafe one', async () => {
    const boss = await superIdentity();
    expect((await googleLogin(boss, { next: '/log?who=partner' })).location).toBe('/log?who=partner');
    expect((await googleLogin(boss, { next: '//evil.com' })).location).toBe('/');
    expect((await googleLogin(boss, { next: 'https://evil.com/' })).location).toBe('/');
    expect((await googleLogin(boss, { next: '/\\evil.com' })).location).toBe('/');
  });

  it('is rate-limited per IP', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i <= LIMITS.oauthCallback.max; i++) last = (await api('GET', '/api/auth/google/callback?code=x&state=y', { ip })).status;
    expect(last).toBe(429);
  });
});

describe('sessions', () => {
  it('issues an HttpOnly, Secure, SameSite=Lax session cookie and stores only its hash', async () => {
    const res = await googleLogin(await superIdentity());
    const session = res.setCookies.find((c) => c.startsWith('spotter_session='))!;
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax']) expect(session).toContain(attr);
    const token = res.cookie!.split('=')[1];
    expect(await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').bind(token).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).first()).not.toBeNull();
  });

  it('returns the current user from /me and 401 without a valid session', async () => {
    const user = await newUser('Ola');
    const me = await api('GET', '/api/auth/me', { cookie: user.cookie });
    expect(me.data.user).toMatchObject({ id: user.id, displayName: 'Ola', isSuper: false, avatarUrl: 'https://lh3.googleusercontent.com/a/test' });
    expect((await api('GET', '/api/auth/me')).status).toBe(401);
    expect((await api('GET', '/api/auth/me', { cookie: 'spotter_session=forged' })).status).toBe(401);
  });

  it('logout invalidates the session server-side', async () => {
    const user = await newUser();
    expect((await api('POST', '/api/auth/logout', { cookie: user.cookie })).setCookies[0]).toContain('Max-Age=0');
    expect((await api('GET', '/api/auth/me', { cookie: user.cookie })).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const user = await newUser();
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(Date.now() - 1, user.id).run();
    expect((await api('GET', '/api/auth/me', { cookie: user.cookie })).status).toBe(401);
  });
});

describe('dev login', () => {
  const LOCAL = 'http://localhost:4321';
  const on = { DEV_LOGIN: 'true' };

  it('is off unless DEV_LOGIN is exactly "true"', async () => {
    const user = await newUser();
    expect((await api('GET', '/api/auth/dev-login', { base: LOCAL })).status).toBe(404);
    for (const val of ['', '1', 'TRUE', 'yes']) {
      const res = await api('POST', '/api/auth/dev-login', { base: LOCAL, env: { DEV_LOGIN: val }, body: { email: user.email } });
      expect(res.status, val).toBe(404);
    }
  });

  it('fails closed on any non-localhost host, even when enabled', async () => {
    const user = await newUser();
    for (const base of [BASE, 'https://partner-gym-trainer.example.workers.dev', 'http://localhost.evil.com', 'http://127.0.0.2:8788']) {
      expect((await api('GET', '/api/auth/dev-login', { base, env: on })).status, base).toBe(404);
      expect((await api('POST', '/api/auth/dev-login', { base, env: on, body: { email: user.email } })).status, base).toBe(404);
    }
  });

  it('signs in a seeded user on localhost when enabled', async () => {
    const user = await newUser('Dev');
    expect((await api('GET', '/api/auth/dev-login', { base: LOCAL, env: on })).data).toEqual({ enabled: true });
    const res = await api('POST', '/api/auth/dev-login', { base: 'http://127.0.0.1:8788', env: on, body: { email: user.email } });
    expect(res.status).toBe(200);
    expect((await api('GET', '/api/auth/me', { cookie: res.cookie })).data.user.id).toBe(user.id);
    expect((await api('POST', '/api/auth/dev-login', { base: LOCAL, env: on, body: { email: uniqueEmail() } })).status).toBe(404);
  });
});

/**
 * A fresh identity whose email is a super user for this request only, so it
 * WOULD be created if the callback let it through: proves rejections create
 * nothing.
 */
function wouldBeSuper() {
  const who = stranger();
  return { who, opts: { env: { SUPER_USER_EMAILS: who.email } } };
}

/** The configured super user's Google identity (account may already exist). */
async function superIdentity() {
  await superCookie();
  return { sub: 'sub-boss@example.com', email: 'boss@example.com', name: 'Boss' };
}
