// Single Pages Function entry for /api/*. Routing and the shared auth
// middleware live in functions/_lib so they can be unit tested directly.
import { handle } from '../_lib/app';
import type { Env } from '../_lib/types';

export const onRequest: PagesFunction<Env> = (ctx) => handle(ctx.request, ctx.env, (p) => ctx.waitUntil(p));
