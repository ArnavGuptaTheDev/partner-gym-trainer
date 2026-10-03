import { useEffect, useState } from 'preact/hooks';
import { pairing as t } from '../content/copy';
import { ApiError, del, get, patch, post } from '../lib/api';

interface PairState {
  pair: null | {
    type: 'couple' | 'friends';
    allowSelfEdit: boolean;
    togetherSince: string | null;
    partner: { displayName: string };
  };
  code: null | { code: string; pairType: string; expiresAt: number };
}

const pretty = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export default function PairingPanel() {
  const [state, setState] = useState<PairState | null>(null);
  const [error, setError] = useState('');
  const welcome = typeof location !== 'undefined' && new URLSearchParams(location.search).has('welcome');

  const load = () => get<PairState>('/api/pair').then(setState).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  if (!state) return <section class="card"><p class="muted" style="margin:0">Loading…</p></section>;

  return (
    <section class="card stack" aria-labelledby="pair-h">
      <h2 id="pair-h">{t.title}</h2>
      {welcome && !state.pair && <p class="alert alert--ok">{t.welcome}</p>}
      {error && <p class="alert alert--error" role="alert">{error}</p>}
      {state.pair ? <Paired pair={state.pair} run={run} /> : <Unpaired code={state.code} run={run} />}
    </section>
  );
}

function Unpaired({ code, run }: { code: PairState['code']; run: (fn: () => Promise<unknown>) => void }) {
  const [type, setType] = useState<'couple' | 'friends'>('couple');
  const [input, setInput] = useState('');

  async function share() {
    if (!code) return;
    const text = t.shareText(pretty(code.code));
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else await navigator.clipboard.writeText(text);
  }

  return (
    <>
      <p class="muted" style="margin:0">{t.unpairedLead}</p>
      {code ? (
        <div class="card card--sun stack center">
          <span class="small">{t.yourCode}</span>
          <strong class="display" style="font-size:2.2rem;letter-spacing:0.08em" aria-live="polite">{pretty(code.code)}</strong>
          <span class="small">{t.codeHint}</span>
          <div class="row" style="justify-content:center">
            <button class="btn btn--small" type="button" onClick={share}>{t.share}</button>
            <button class="btn btn--small btn--ghost" type="button" onClick={() => run(() => del('/api/pair/code'))}>{t.cancelCode}</button>
          </div>
        </div>
      ) : (
        <form class="stack" onSubmit={(e) => { e.preventDefault(); run(() => post('/api/pair/code', { pairType: type })); }}>
          <fieldset>
            <legend>{t.typeLegend}</legend>
            <div class="segmented">
              {(['couple', 'friends'] as const).map((k) => (
                <label key={k}>
                  <input type="radio" name="ptype" value={k} checked={type === k} onChange={() => setType(k)} />
                  <span>{t[k]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button class="btn btn--block" type="submit">{t.makeCode}</button>
        </form>
      )}
      <form class="stack" onSubmit={(e) => { e.preventDefault(); run(() => post('/api/pair/join', { code: input })); }}>
        <div class="field">
          <label for="pair-code">{t.haveCode}</label>
          <div class="row">
            <input id="pair-code" value={input} onInput={(e) => setInput(e.currentTarget.value)} autocapitalize="characters" autocomplete="off" placeholder="ABCD-2345" aria-label={t.codeLabel} />
            <button class="btn btn--sun" type="submit" disabled={input.trim().length < 4}>{t.join}</button>
          </div>
        </div>
      </form>
    </>
  );
}

function Paired({ pair, run }: { pair: NonNullable<PairState['pair']>; run: (fn: () => Promise<unknown>) => void }) {
  const [type, setType] = useState(pair.type);
  const [since, setSince] = useState(pair.togetherSince ?? '');
  const [selfEdit, setSelfEdit] = useState(pair.allowSelfEdit);
  const [saved, setSaved] = useState(false);

  async function save(e: Event) {
    e.preventDefault();
    await run(() => patch('/api/pair', { pairType: type, allowSelfEdit: selfEdit, togetherSince: since || null }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form class="stack" onSubmit={save}>
      <p style="margin:0">
        {t.pairedWith} <strong>{pair.partner.displayName}</strong> {pair.type === 'couple' ? '💞' : '🤜🤛'}
      </p>
      <fieldset>
        <legend>{t.pairTypeLabel}</legend>
        <div class="segmented">
          {(['couple', 'friends'] as const).map((k) => (
            <label key={k}>
              <input type="radio" name="ptype" value={k} checked={type === k} onChange={() => setType(k)} />
              <span>{t[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {type === 'couple' && (
        <div class="field">
          <label for="since">{t.togetherSince}</label>
          <input id="since" type="date" value={since} onInput={(e) => setSince(e.currentTarget.value)} aria-describedby="since-hint" />
          <span class="hint" id="since-hint">{t.togetherHint}</span>
        </div>
      )}
      <label class="row" style="align-items:flex-start">
        <input type="checkbox" checked={selfEdit} onChange={(e) => setSelfEdit(e.currentTarget.checked)} />
        <span>
          <strong>{t.selfEdit}</strong>
          <br />
          <span class="small muted">{t.selfEditHint}</span>
        </span>
      </label>
      <button class="btn" type="submit">{saved ? t.saved : t.save}</button>
      <button class="btn btn--danger" type="button" onClick={() => confirm(t.unpairConfirm) && run(() => del('/api/pair'))}>
        {t.unpair}
      </button>
    </form>
  );
}
