import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { get } from './api';

/** Cursor-paginated list: `{ items, nextCursor }` endpoints. */
export function usePaged<T>(url: string | null, limit = 20) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const fetchPage = useCallback(
    async (cur: string | null, replace: boolean) => {
      if (!url) return;
      const my = ++gen.current;
      setLoading(true);
      try {
        const sep = url.includes('?') ? '&' : '?';
        const res = await get<{ items: T[]; nextCursor: string | null }>(
          `${url}${sep}limit=${limit}${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`,
        );
        if (my !== gen.current) return;
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
        setCursor(res.nextCursor);
        setError(null);
      } catch (e) {
        if (my === gen.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === gen.current) setLoading(false);
      }
    },
    [url, limit],
  );

  useEffect(() => {
    fetchPage(null, true);
  }, [fetchPage]);

  return {
    items,
    setItems,
    loading,
    error,
    hasMore: !!cursor,
    loadMore: () => fetchPage(cursor, false),
    reload: () => fetchPage(null, true),
  };
}

/**
 * Calls `fn` every `ms` while the tab is visible; pauses when hidden and
 * fires immediately on becoming visible again.
 */
export function useVisiblePolling(fn: () => void | Promise<void>, ms: number, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          await saved.current();
        } catch {
          /* keep polling */
        }
      }
      if (!stopped && document.visibilityState === 'visible') timer = setTimeout(tick, ms);
    };
    const onVis = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    timer = setTimeout(tick, ms);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, enabled]);
}
