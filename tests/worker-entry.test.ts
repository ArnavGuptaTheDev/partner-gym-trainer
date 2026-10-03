import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/types';
import { env } from './helpers';

// A stand-in for the Workers Static Assets binding.
const assetRequests: string[] = [];
const ASSETS = {
  fetch: async (req: Request) => {
    assetRequests.push(new URL(req.url).pathname);
    return new Response('<!doctype html>static', { headers: { 'content-type': 'text/html' } });
  },
} as unknown as Fetcher;

async function call(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://spotter.test${path}`), { ...(env as unknown as Env), ASSETS }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('worker entry', () => {
  it('routes /api/* to the API', async () => {
    const res = await call('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await call('/api/nope')).status).toBe(404);
    expect(assetRequests).toEqual([]);
  });

  it('serves everything else from static assets', async () => {
    for (const path of ['/', '/login', '/apix', '/icons/icon.svg']) {
      const res = await call(path);
      expect(await res.text()).toContain('static');
    }
    expect(assetRequests).toEqual(['/', '/login', '/apix', '/icons/icon.svg']);
  });
});
