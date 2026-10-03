import { badRequest, json, readJson } from '../http';
import type { Router } from '../router';
import { clearSessionCookie } from '../session';
import { parse, v } from '../validate';
import { DELETE_CONFIRMATION } from '../../shared/account';

export { DELETE_CONFIRMATION } from '../../shared/account';

const DeleteBody = v.object({ confirm: v.string({ max: 40 }) });

export function registerAccountRoutes(r: Router) {
  /**
   * Self-service account deletion.
   *
   * 1. Deletes the user's R2 objects: their gym/chat photos, and photos on
   *    their own plan (including ones their partner uploaded to it).
   * 2. Deletes the user row. Every table that references users cascades
   *    (see migrations), which also removes the pair (and with it the shared
   *    chat, reactions, nudges and notes) and all sessions. References from
   *    the partner's data (e.g. "plan set by", "photo uploaded by") are set
   *    to NULL; the partner keeps their own data.
   */
  r.delete('/api/account', {}, async (c) => {
    const { confirm } = parse(DeleteBody, await readJson(c.req));
    if (confirm !== DELETE_CONFIRMATION) throw badRequest(`confirm: type "${DELETE_CONFIRMATION}" to delete your account`, { field: 'confirm' });

    const db = c.env.DB;
    const [photos, media] = await db.batch([
      db.prepare('SELECT r2_key FROM photos WHERE user_id = ?').bind(c.user.id),
      db.prepare('SELECT r2_key FROM plan_media WHERE user_id = ?').bind(c.user.id),
    ]);
    const keys = [...photos.results, ...media.results].map((row) => (row as { r2_key: string }).r2_key);

    // Objects first: if the row delete then fails, a retry still finds the
    // account; the reverse order could strand unreachable private photos.
    for (let i = 0; i < keys.length; i += 1000) await c.env.PHOTOS.delete(keys.slice(i, i + 1000));
    await db.prepare('DELETE FROM users WHERE id = ?').bind(c.user.id).run();

    return json({ ok: true, deletedObjects: keys.length }, { headers: { 'set-cookie': clearSessionCookie() } });
  });
}
