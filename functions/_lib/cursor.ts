// Keyset pagination over (sort_key DESC, id DESC). The cursor is opaque to
// clients: they just pass back `nextCursor`.

export interface Cursor {
  key: number;
  id: string;
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  const i = raw.indexOf('_');
  if (i < 1) return null;
  const key = Number(raw.slice(0, i));
  const id = raw.slice(i + 1);
  return Number.isFinite(key) && id ? { key, id } : null;
}

export const encodeCursor = (key: number, id: string | number) => `${key}_${id}`;

/**
 * Given `limit + 1` rows, trims the extra row and returns the next cursor.
 */
export function page<T>(rows: T[], limit: number, keyOf: (r: T) => [number, string | number]) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: more && last ? encodeCursor(...keyOf(last)) : null };
}
