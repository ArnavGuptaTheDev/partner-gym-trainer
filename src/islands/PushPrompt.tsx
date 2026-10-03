// Dismissible Home card offering notifications once you're paired. Never
// asks for permission on its own; only the button does.
import { useEffect, useState } from 'preact/hooks';
import { push as t } from '../content/copy';
import { enablePush, hasSubscription, pushConfig, pushState, type PushState } from '../lib/push';
import { PushBlocked } from './PushSettings';

const DISMISS_KEY = 'spotter-push-prompt-dismissed';

export default function PushPrompt({ partnerName }: { partnerName: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem(DISMISS_KEY)) return;
      } catch {
        /* storage unavailable: still offer */
      }
      const s = pushState();
      // Blocked or unsupported: Settings explains; don't nag on Home.
      if (s === 'denied' || s === 'unsupported') return;
      const cfg = await pushConfig();
      if (!cfg.publicKey) return;
      if (cfg.enabled && (await hasSubscription())) return;
      setState(s);
      setShow(true);
    })().catch(() => {});
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  if (!show || !state) return null;
  return (
    <section class="card stack push-prompt" aria-labelledby="push-prompt-h">
      <h2 id="push-prompt-h">🔔 {t.promptTitle(partnerName)}</h2>
      <p class="small" style="margin:0">{t.promptLead}</p>
      {state === 'ios-install' || state === 'denied' ? (
        <PushBlocked state={state} />
      ) : (
        <button
          class="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await enablePush().catch(() => 'dismissed' as const);
            setBusy(false);
            if (r === 'ok') setShow(false);
            else setState(pushState());
          }}
        >
          {busy ? t.turningOn : t.turnOn}
        </button>
      )}
      <button class="btn btn--ghost btn--small" type="button" style="align-self:flex-start" onClick={dismiss}>{t.notNow}</button>
    </section>
  );
}
