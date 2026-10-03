import { json } from '../http';
import type { Router } from '../router';
import { unreadStmt } from './chat';

export function registerSocialRoutes(r: Router) {
  // Cheap, frequently polled status for badges.
  r.get('/api/pulse', {}, async (c) => {
    if (!c.pair) return json({ unread: 0 });
    const [unread] = await c.env.DB.batch([unreadStmt(c.env.DB, c.pair.id, c.user.id)]);
    return json({ unread: (unread.results[0] as { n: number }).n });
  });
}
