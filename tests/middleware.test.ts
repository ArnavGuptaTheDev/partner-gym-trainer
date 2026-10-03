import { describe, expect, it } from 'vitest';
import { api, newUser } from './helpers';

describe('request pipeline', () => {
  it('404s unknown endpoints and 405s wrong methods', async () => {
    expect((await api('GET', '/api/nope')).status).toBe(404);
    expect((await api('DELETE', '/api/auth/me')).status).toBe(405);
  });

  it('rejects cross-origin mutations even with a valid session', async () => {
    const user = await newUser();
    const res = await api('POST', '/api/auth/logout', { cookie: user.cookie, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    const same = await api('POST', '/api/auth/logout', { cookie: user.cookie, headers: { origin: 'https://spotter.test' } });
    expect(same.status).toBe(200);
  });

  it('requires a JSON content type and rejects malformed JSON', async () => {
    const user = await newUser();
    const form = await api('POST', '/api/pair/code', { cookie: user.cookie, rawBody: 'pairType=couple', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(form.status).toBe(400);
    const bad = await api('POST', '/api/pair/code', { cookie: user.cookie, rawBody: '{nope', headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
  });

  it('never caches API responses', async () => {
    const res = await api('GET', '/api/invites/x');
    expect(res.res.headers.get('cache-control')).toBe('no-store');
  });
});
