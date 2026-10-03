// The shared authorization middleware: `:who` resolution and read/write rules.
import { describe, expect, it } from 'vitest';
import { resolveWho } from '../functions/_lib/middleware';
import type { Ctx, Pair } from '../functions/_lib/types';
import { api, newPair, newUser, pairUp } from './helpers';

const PLAN = { calorieGoal: 'deficit', calorieTarget: 1800, meals: [], exercises: [] };

function ctx(method: string, who: string, opts: { paired?: boolean; selfEdit?: boolean } = {}): Ctx {
  const pair: Pair | null = opts.paired
    ? { id: 'p', user_a_id: 'me', user_b_id: 'them', pair_type: 'friends', allow_self_edit: opts.selfEdit ? 1 : 0, together_since: null, created_at: 0 }
    : null;
  return {
    req: new Request('https://x.test/', { method }),
    params: { who },
    user: { id: 'me' },
    pair,
    partnerId: pair ? 'them' : null,
  } as unknown as Ctx;
}

describe('resolveWho (unit)', () => {
  it('maps me/partner to user ids', () => {
    const c = ctx('GET', 'partner', { paired: true });
    resolveWho(c, 'read');
    expect(c.subjectId).toBe('them');
    expect(c.isSelf).toBe(false);
    const m = ctx('GET', 'me');
    resolveWho(m, 'read');
    expect(m.subjectId).toBe('me');
  });

  it('never accepts a raw user id or unknown alias', () => {
    expect(() => resolveWho(ctx('GET', 'them', { paired: true }), 'read')).toThrow();
    expect(() => resolveWho(ctx('GET', 'partner'), 'read')).toThrow(); // unpaired
  });

  it("'self' routes reject writes to the partner but allow reads", () => {
    expect(() => resolveWho(ctx('PUT', 'partner', { paired: true }), 'self')).toThrow(/own/);
    expect(() => resolveWho(ctx('GET', 'partner', { paired: true }), 'self')).not.toThrow();
  });

  it("'plan' routes: partner edits you; self only if allowed or unpaired", () => {
    expect(() => resolveWho(ctx('PUT', 'partner', { paired: true }), 'plan')).not.toThrow();
    expect(() => resolveWho(ctx('PUT', 'me', { paired: true }), 'plan')).toThrow();
    expect(() => resolveWho(ctx('PUT', 'me', { paired: true, selfEdit: true }), 'plan')).not.toThrow();
    expect(() => resolveWho(ctx('PUT', 'me'), 'plan')).not.toThrow();
  });
});

describe('authorization (through the API)', () => {
  it('requires a session on every user route', async () => {
    for (const path of ['/api/u/me/profile', '/api/u/me/plan', '/api/u/me/weights', '/api/pair']) {
      expect((await api('GET', path)).status).toBe(401);
    }
  });

  it('unpaired users cannot reach any partner data', async () => {
    const solo = await newUser();
    expect((await api('GET', '/api/u/partner/profile', { cookie: solo.cookie })).status).toBe(404);
    expect((await api('GET', '/api/u/partner/plan', { cookie: solo.cookie })).status).toBe(404);
    expect((await api('PUT', '/api/u/partner/plan', { cookie: solo.cookie, body: PLAN })).status).toBe(404);
  });

  it('rejects user ids in place of me/partner', async () => {
    const { a, b } = await newPair();
    expect((await api('GET', `/api/u/${b.id}/profile`, { cookie: a.cookie })).status).toBe(404);
  });

  it('partners can read each other but only write their own log/profile', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/me/weights/2026-01-01', { cookie: b.cookie, body: { weightKg: 70 } });

    const read = await api('GET', '/api/u/partner/weights', { cookie: a.cookie });
    expect(read.status).toBe(200);
    expect(read.data.items[0]).toEqual({ date: '2026-01-01', weightKg: 70 });

    expect((await api('PUT', '/api/u/partner/weights/2026-01-02', { cookie: a.cookie, body: { weightKg: 1 } })).status).toBe(403);
    expect((await api('DELETE', '/api/u/partner/weights/2026-01-01', { cookie: a.cookie })).status).toBe(403);
    expect((await api('PATCH', '/api/u/partner/profile', { cookie: a.cookie, body: { heightCm: 100 } })).status).toBe(403);
  });

  it('plans are set by the partner, not yourself, unless self-editing is on', async () => {
    const { a, b } = await newPair();
    expect((await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body: PLAN })).status).toBe(200);
    expect((await api('PUT', '/api/u/me/plan', { cookie: b.cookie, body: PLAN })).status).toBe(403);
    const view = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(view.data.canEdit).toBe(false);
    expect(view.data.plan.calorieTarget).toBe(1800);

    await api('PATCH', '/api/pair', { cookie: a.cookie, body: { allowSelfEdit: true } });
    expect((await api('PUT', '/api/u/me/plan', { cookie: b.cookie, body: PLAN })).status).toBe(200);
  });

  it('a third person can never see a pair’s data', async () => {
    const { a } = await newPair();
    await api('PUT', '/api/u/me/weights/2026-02-02', { cookie: a.cookie, body: { weightKg: 81 } });
    const c = await newUser();
    const d = await newUser();
    await pairUp(c, d);
    const res = await api('GET', '/api/u/partner/weights', { cookie: c.cookie });
    expect(res.data.items).toEqual([]); // d's (empty) data, not a's
  });

  it('after unpairing, each keeps their own data and loses the other’s', async () => {
    const { a, b } = await newPair();
    await api('PUT', '/api/u/me/weights/2026-03-03', { cookie: a.cookie, body: { weightKg: 60 } });
    await api('PUT', '/api/u/partner/plan', { cookie: b.cookie, body: PLAN });
    await api('DELETE', '/api/pair', { cookie: a.cookie });

    expect((await api('GET', '/api/u/partner/weights', { cookie: b.cookie })).status).toBe(404);
    expect((await api('GET', '/api/u/partner/plan', { cookie: b.cookie })).status).toBe(404);
    const own = await api('GET', '/api/u/me/weights', { cookie: a.cookie });
    expect(own.data.items).toHaveLength(1);
    // a keeps the plan b wrote for them and may now edit it themselves.
    const plan = await api('GET', '/api/u/me/plan', { cookie: a.cookie });
    expect(plan.data.plan.calorieTarget).toBe(1800);
    expect(plan.data.canEdit).toBe(true);
  });
});
