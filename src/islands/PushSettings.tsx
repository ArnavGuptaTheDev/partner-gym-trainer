import { useEffect, useState } from 'preact/hooks';
import { push as t } from '../content/copy';
import { ApiError, get, post, put } from '../lib/api';
import { enablePush, hasSubscription, pushConfig, pushState, unsubscribeThisDevice, type PushState } from '../lib/push';
import { ErrorNote } from './ui';

interface Prefs {
  enabled: boolean;
  types: Record<string, boolean>;
  hidePreviews: boolean;
}

const TYPES = ['message', 'nudge', 'photo', 'plan', 'note', 'milestone', 'workout'] as const;

/** Explains what to do instead of showing a button that can't work. */
export function PushBlocked({ state }: { state: PushState }) {
  if (state === 'ios-install') {
    return (
      <div class="stack" style="gap:6px">
        <strong>{t.iosTitle}</strong>
        <ol class="small" style="margin:0;padding-left:20px">{t.iosSteps.map((s) => <li key={s}>{s}</li>)}</ol>
      </div>
    );
  }
  if (state === 'denied') {
    return (
      <div class="stack" style="gap:6px">
        <strong>{t.deniedTitle}</strong>
        <p class="small" style="margin:0">{t.deniedLead}</p>
        <ul class="small" style="margin:0;padding-left:20px">{t.deniedSteps.map((s) => <li key={s}>{s}</li>)}</ul>
        <p class="small muted" style="margin:0">{t.deniedAfter}</p>
      </div>
    );
  }
  return <p class="small muted" style="margin:0">{t.unsupported}</p>;
}

export default function PushSettings() {
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);
  const [state, setState] = useState<PushState>('default');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    const [cfg, p] = await Promise.all([pushConfig(), get<Prefs>('/api/push/prefs')]);
    setAvailable(!!cfg.publicKey);
    setState(pushState());
    setPrefs(p);
    setSubscribed(await hasSubscription().catch(() => false));
    setReady(true);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  if (!ready) return null;
  if (!available) return null; // server not configured: hide the feature

  async function turnOn() {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await enablePush();
      if (r === 'dismissed') setMsg(t.dismissed);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: Record<string, boolean>) {
    setError('');
    try {
      setPrefs(await put<Prefs>('/api/push/prefs', patch));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function sendTest() {
    setMsg('');
    try {
      const r = await post<{ delivered: number }>('/api/push/test');
      setMsg(t.testSent(r.delivered));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const blocked = state === 'ios-install' || state === 'denied' || state === 'unsupported';
  const on = !!prefs?.enabled;

  return (
    <section class="card stack" aria-labelledby="push-h">
      <h2 id="push-h">{t.title}</h2>
      <p class="small muted" style="margin:0">{t.lead}</p>

      {blocked ? (
        <PushBlocked state={state} />
      ) : !on || !subscribed ? (
        <>
          {on && !subscribed && <p class="small" style="margin:0">{t.thisDeviceOff}</p>}
          <button class="btn" type="button" disabled={busy} onClick={turnOn}>{busy ? t.turningOn : on ? t.enableHere : t.turnOn}</button>
        </>
      ) : null}

      {prefs && (on || subscribed) && (
        <div class="stack" style="gap:8px">
          <Switch id="push-master" label={t.master} checked={on} onChange={async (v) => {
            if (!v) await unsubscribeThisDevice();
            await save({ enabled: v });
            if (v && !blocked) await turnOn();
            else await refresh();
          }} />
          <fieldset class="stack" style="gap:8px" disabled={!on}>
            <legend class="sr-only">{t.title}</legend>
            {TYPES.map((k) => (
              <Switch key={k} id={`push-${k}`} label={t.types[k]} checked={prefs.types[k]} onChange={(v) => save({ [k]: v })} />
            ))}
            <Switch id="push-hide" label={t.hidePreviews} hint={t.hidePreviewsHint} checked={prefs.hidePreviews} onChange={(v) => save({ hidePreviews: v })} />
          </fieldset>
          {on && subscribed && <button class="btn btn--ghost btn--small" type="button" style="align-self:flex-start" onClick={sendTest}>{t.test}</button>}
        </div>
      )}
      {msg && <p class="alert alert--ok" role="status" style="margin:0">{msg}</p>}
      <ErrorNote>{error}</ErrorNote>
      <p class="small muted" style="margin:0">{t.privacyNote}</p>
    </section>
  );
}

function Switch({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div class="switch-row">
      <label for={id}>
        {label}
        {hint && <span class="hint" style="display:block">{hint}</span>}
      </label>
      <input id={id} type="checkbox" role="switch" class="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </div>
  );
}
