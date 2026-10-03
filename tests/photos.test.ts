import { describe, expect, it } from 'vitest';
import { hasMetadata, sniffMime } from '../functions/_lib/image';
import { MAX_UPLOADS_PER_DAY } from '../functions/_lib/routes/photos';
import { api, env, newPair, newUser, superCookie, type TestUser } from './helpers';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((ch) => ch.charCodeAt(0)) : p)));

// Minimal byte layouts; enough for the header checks, not real images.
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF\0', new Array(9).fill(0), [0xff, 0xda, 0x00, 0x02], [0xff, 0xd9]);
const JPEG_EXIF = bytes([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10], 'Exif\0\0', new Array(8).fill(0), [0xff, 0xda, 0x00, 0x02], [0xff, 0xd9]);
const WEBP = bytes('RIFF', [20, 0, 0, 0], 'WEBP', 'VP8 ', [4, 0, 0, 0], [1, 2, 3, 4]);
const WEBP_EXIF = bytes('RIFF', [32, 0, 0, 0], 'WEBP', 'VP8 ', [4, 0, 0, 0], [1, 2, 3, 4], 'EXIF', [4, 0, 0, 0], [0, 0, 0, 0]);
const PNG = bytes([0x89], 'PNG\r\n', [0x1a, 0x0a], new Array(16).fill(0));

async function upload(user: TestUser, data: Uint8Array, extra: Record<string, string> = {}, who = 'me') {
  const form = new FormData();
  form.set('file', new File([data], 'p.jpg', { type: 'image/jpeg' }));
  form.set('kind', extra.kind ?? 'gym');
  form.set('date', extra.date ?? '2026-06-01');
  if (extra.caption) form.set('caption', extra.caption);
  return api('POST', `/api/u/${who}/photos`, { cookie: user.cookie, rawBody: form });
}

describe('image checks (unit)', () => {
  it('sniffs real signatures, not the declared type', () => {
    expect(sniffMime(JPEG)).toBe('image/jpeg');
    expect(sniffMime(WEBP)).toBe('image/webp');
    expect(sniffMime(PNG)).toBeNull();
  });
  it('detects leftover EXIF', () => {
    expect(hasMetadata(JPEG, 'image/jpeg')).toBe(false);
    expect(hasMetadata(JPEG_EXIF, 'image/jpeg')).toBe(true);
    expect(hasMetadata(WEBP, 'image/webp')).toBe(false);
    expect(hasMetadata(WEBP_EXIF, 'image/webp')).toBe(true);
  });
});

describe('photos', () => {
  it('stores uploads privately and serves them to owner and partner only', async () => {
    const { a, b } = await newPair();
    const up = await upload(b, JPEG, { caption: 'leg day' });
    expect(up.status).toBe(201);
    expect(up.data).toMatchObject({ date: '2026-06-01', caption: 'leg day', url: `/api/photos/${up.data.id}` });

    const own = await api('GET', up.data.url, { cookie: b.cookie });
    expect(own.status).toBe(200);
    expect(own.res.headers.get('content-type')).toBe('image/jpeg');
    expect(own.res.headers.get('cache-control')).toContain('private');
    expect(new Uint8Array(await own.res.arrayBuffer())).toEqual(JPEG);

    expect((await api('GET', up.data.url, { cookie: a.cookie })).status).toBe(200);
    expect((await api('GET', up.data.url)).status).toBe(401);
    const stranger = await newUser();
    expect((await api('GET', up.data.url, { cookie: stranger.cookie })).status).toBe(404);

    const timeline = await api('GET', '/api/u/partner/photos', { cookie: a.cookie });
    expect(timeline.data.items.map((p: any) => p.id)).toEqual([up.data.id]);
  });

  it('cuts off the ex-partner after unpairing; the owner keeps their photos', async () => {
    const { a, b } = await newPair();
    const up = await upload(b, WEBP);
    await api('DELETE', '/api/pair', { cookie: a.cookie });
    expect((await api('GET', up.data.url, { cookie: a.cookie })).status).toBe(404);
    expect((await api('GET', up.data.url, { cookie: b.cookie })).status).toBe(200);
  });

  it('rejects non-JPEG/WebP, leftover EXIF, oversize files and partner uploads', async () => {
    const { a, b } = await newPair();
    expect((await upload(b, PNG)).status).toBe(415);
    expect((await upload(b, JPEG_EXIF)).status).toBe(400);
    expect((await upload(b, WEBP_EXIF)).status).toBe(400);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(JPEG);
    expect((await upload(b, big)).status).toBe(413);
    expect((await upload(a, JPEG, {}, 'partner')).status).toBe(403);
    expect((await upload(b, JPEG, { date: '2999-01-01' })).status).toBe(400);
  });

  it(`caps uploads at ${MAX_UPLOADS_PER_DAY} per user per day`, async () => {
    const u = await newUser();
    for (let i = 0; i < MAX_UPLOADS_PER_DAY; i++) expect((await upload(u, JPEG)).status).toBe(201);
    expect((await upload(u, JPEG)).status).toBe(429);
  });

  it('chat photos stay out of the timeline and the feed', async () => {
    const u = await newUser();
    await upload(u, JPEG, { kind: 'chat' });
    expect((await api('GET', '/api/u/me/photos', { cookie: u.cookie })).data.items).toHaveLength(0);
    const acts = await env.DB.prepare("SELECT count(*) AS n FROM activities WHERE user_id = ? AND type = 'photo'").bind(u.id).first();
    expect(acts).toEqual({ n: 0 });
  });

  it('deletes from R2 and D1; only the owner can delete', async () => {
    const { a, b } = await newPair();
    const up = await upload(b, JPEG);
    expect((await api('DELETE', `/api/u/partner/photos/${up.data.id}`, { cookie: a.cookie })).status).toBe(403);
    expect((await api('DELETE', `/api/u/me/photos/${up.data.id}`, { cookie: a.cookie })).status).toBe(404);
    expect((await api('DELETE', `/api/u/me/photos/${up.data.id}`, { cookie: b.cookie })).status).toBe(200);
    expect(await env.PHOTOS.get(`u/${b.id}/${up.data.id}.jpg`)).toBeNull();
    expect((await api('GET', up.data.url, { cookie: b.cookie })).status).toBe(404);
  });

  it('reports total storage to super users only', async () => {
    const u = await newUser();
    await upload(u, JPEG);
    expect((await api('GET', '/api/admin/storage', { cookie: u.cookie })).status).toBe(403);
    const res = await api('GET', '/api/admin/storage', { cookie: await superCookie() });
    expect(res.data.totalBytes).toBeGreaterThanOrEqual(JPEG.byteLength);
    expect(res.data.photoCount).toBeGreaterThanOrEqual(1);
  });

  it('paginates the timeline', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await upload(u, JPEG);
    const p1 = await api('GET', '/api/u/me/photos?limit=2', { cookie: u.cookie });
    expect(p1.data.items).toHaveLength(2);
    const p2 = await api('GET', `/api/u/me/photos?limit=2&cursor=${encodeURIComponent(p1.data.nextCursor)}`, { cookie: u.cookie });
    expect(p2.data.items).toHaveLength(1);
    expect(p2.data.nextCursor).toBeNull();
  });
});
