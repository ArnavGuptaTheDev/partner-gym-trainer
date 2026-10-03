// Cloudflare Worker entry. Static pages and assets in dist/ are served by
// Workers Static Assets without invoking this script; only /api/* runs here
// (see run_worker_first in wrangler.toml). The ASSETS fallback covers any
// request that reaches the Worker but isn't an API call.
import { handle } from './app';
import type { Env } from './types';

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handle(request, env, (p) => ctx.waitUntil(p));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
