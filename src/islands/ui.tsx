// Small shared Preact pieces used across islands.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getMe, type Me } from '../lib/api';

export type Who = 'me' | 'partner';

/** Loads /api/auth/me once and renders children with it. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    getMe().then(setMe).catch(() => {});
  }, []);
  return me;
}

export function WhoToggle({ who, onChange, me, mineLabel, partnerLabel }: {
  who: Who;
  onChange: (w: Who) => void;
  me: Me;
  mineLabel: string;
  partnerLabel: (name: string) => string;
}) {
  if (!me.pair) return null;
  return (
    <div class="segmented" role="group" aria-label="Whose">
      {(['me', 'partner'] as const).map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={who === w}
          class="seg-btn"
          onClick={() => onChange(w)}
        >
          {w === 'me' ? mineLabel : partnerLabel(me.pair!.partner.displayName)}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <p class="muted" aria-live="polite">Loading…</p>;
}

export function ErrorNote({ children }: { children: ComponentChildren }) {
  if (!children) return null;
  return <p class="alert alert--error" role="alert">{children}</p>;
}

/** Remembers a value per page in the URL hash-free query, e.g. ?who=partner. */
export function useQueryState<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const read = () => (typeof location === 'undefined' ? initial : ((new URLSearchParams(location.search).get(key) as T) ?? initial));
  const [val, setVal] = useState<T>(read);
  const set = (v: T) => {
    setVal(v);
    const u = new URL(location.href);
    u.searchParams.set(key, v);
    history.replaceState(null, '', u);
  };
  return [val, set];
}
