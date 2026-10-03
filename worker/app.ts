import { errorResponse, HttpError, json } from './http';
import { authenticate, checkOrigin, requireSuper, resolveWho } from './middleware';
import { Router } from './router';
import type { Ctx, Env } from './types';
import { registerAuthRoutes } from './routes/auth';
import { registerAdminRoutes } from './routes/admin';
import { registerPairRoutes } from './routes/pair';
import { registerProfileRoutes } from './routes/profile';
import { registerPlanRoutes } from './routes/plan';
import { registerLogRoutes } from './routes/log';
import { registerPhotoRoutes } from './routes/photos';
import { registerChatRoutes } from './routes/chat';
import { registerSocialRoutes } from './routes/social';
import { registerAccountRoutes } from './routes/account';

export const router = new Router();
registerAuthRoutes(router);
registerAdminRoutes(router);
registerPairRoutes(router);
registerProfileRoutes(router);
registerPlanRoutes(router);
registerLogRoutes(router);
registerPhotoRoutes(router);
registerChatRoutes(router);
registerSocialRoutes(router);
registerAccountRoutes(router);

export async function handle(req: Request, env: Env, waitUntil: (p: Promise<unknown>) => void = () => {}): Promise<Response> {
  const url = new URL(req.url);
  try {
    const match = router.match(req.method, url.pathname);
    if (match === 'method') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    if (!match) throw new HttpError(404, 'not_found', 'No such endpoint.');

    const c = {
      req,
      env,
      url,
      params: match.params,
      ip: req.headers.get('cf-connecting-ip') ?? 'local',
      now: Date.now(),
      waitUntil,
    } as Ctx;

    const { opts, handler } = match.route;
    checkOrigin(c);
    if (opts.auth !== 'public') await authenticate(c);
    if (opts.auth === 'super') requireSuper(c);
    if (opts.who) resolveWho(c, opts.who);
    return await handler(c);
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    console.error('Unhandled API error', err);
    return json({ error: { code: 'server_error', message: 'Something went wrong.' } }, { status: 500 });
  }
}
