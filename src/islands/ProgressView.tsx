import { useEffect, useState } from 'preact/hooks';
import { plan as planCopy, progress as t } from '../content/copy';
import { ApiError, del, get, patch, put, today, type Me } from '../lib/api';
import { fmtWeight, fromDisplayHeight, fromDisplayWeight, heightUnit, num, toDisplayHeight, toDisplayWeight, weightUnit, type Units } from '../lib/units';
import { ErrorNote, Loading, useMe, useQueryState, WhoToggle, type Who } from './ui';
import WeightChart, { type Point } from './WeightChart';

interface Profile {
  displayName: string;
  units: Units;
  heightCm: number | null;
  startWeightKg: number | null;
  targetWeightKg: number | null;
  goalMode: 'lose' | 'gain' | 'maintain' | null;
  targetDate: string | null;
  currentWeightKg: number | null;
  isSelf: boolean;
}

export default function ProgressView() {
  const me = useMe();
  const [who, setWho] = useQueryState<Who>('who', 'me');
  if (!me) return <Loading />;
  const effective: Who = me.pair ? who : 'me';
  return (
    <div class="stack">
      <WhoToggle who={effective} onChange={setWho} me={me} mineLabel={planCopy.mine} partnerLabel={planCopy.partners} />
      <ProgressFor key={effective} who={effective} me={me} />
    </div>
  );
}

/** 0..1 progress from start toward target, in the goal's direction. */
export function goalProgress(p: Pick<Profile, 'startWeightKg' | 'targetWeightKg' | 'currentWeightKg'>): number | null {
  const { startWeightKg: s, targetWeightKg: tg, currentWeightKg: c } = p;
  if (s == null || tg == null || c == null || s === tg) return null;
  return Math.max(0, Math.min(1, (s - c) / (s - tg)));
}

function ProgressFor({ who, me }: { who: Who; me: Me }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [weights, setWeights] = useState<Point[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const units = me.user.units; // the viewer's preferred units

  const load = async () => {
    try {
      const [p, w] = await Promise.all([get<Profile>(`/api/u/${who}/profile`), get<{ items: Point[] }>(`/api/u/${who}/weights?limit=60`)]);
      setProfile(p);
      setWeights(w.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    load();
  }, [who]);

  if (error && !profile) return <ErrorNote>{error}</ErrorNote>;
  if (!profile) return <Loading />;

  const pct = goalProgress(profile);
  const remaining = profile.currentWeightKg != null && profile.targetWeightKg != null ? Math.abs(profile.currentWeightKg - profile.targetWeightKg) : null;
  const daysLeft = profile.targetDate ? Math.round((Date.parse(profile.targetDate) - Date.parse(today())) / 86_400_000) : null;

  return (
    <>
      <section class="card stack" aria-labelledby="goal-h">
        <div class="spread">
          <h2 id="goal-h">{t.goalTitle}</h2>
          {profile.goalMode && <span class="pill pill--accent">{t.goalModes[profile.goalMode]}</span>}
        </div>
        <div class="grid-3 center">
          <Stat label={t.start} value={fmtWeight(profile.startWeightKg, units)} />
          <Stat label={t.current} value={fmtWeight(profile.currentWeightKg, units)} strong />
          <Stat label={t.target} value={fmtWeight(profile.targetWeightKg, units)} />
        </div>
        {pct != null && (
          <>
            <div class="progress progress--mint" role="progressbar" aria-label="Progress to target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
              <span style={{ width: `${Math.max(2, pct * 100)}%` }} />
            </div>
            <p class="small" style="margin:0">
              {remaining != null && remaining < 0.05 ? t.reached : remaining != null ? t.toGo(fmtWeight(remaining, units)) : ''}
              {daysLeft != null && <span class="muted"> · {t.daysLeft(daysLeft)}</span>}
            </p>
          </>
        )}
        {profile.isSelf && !editing && (
          <button class="btn btn--ghost btn--small" type="button" onClick={() => setEditing(true)}>{t.editGoal}</button>
        )}
        {editing && <GoalForm profile={profile} units={units} onDone={() => { setEditing(false); location.reload(); }} />}
      </section>

      <section class="card stack" aria-labelledby="w-h">
        <h2 id="w-h">{t.weightTitle}</h2>
        {profile.isSelf && <LogWeight units={units} onSaved={load} />}
        {weights.length === 0 ? (
          <p class="muted" style="margin:0">{t.noWeights}</p>
        ) : (
          <>
            <WeightChart points={weights} targetKg={profile.targetWeightKg} units={units} label={t.chartLabel(weights.length)} />
            <ul class="list small">
              {weights.slice(0, 10).map((w) => (
                <li key={w.date} class="spread">
                  <span>{new Date(`${w.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span class="row">
                    <strong>{fmtWeight(w.weightKg, units)}</strong>
                    {profile.isSelf && (
                      <button class="icon-btn" type="button" aria-label={`${t.remove} ${w.date}`} onClick={async () => { await del(`/api/u/me/weights/${w.date}`); load(); }}>×</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div class="small muted">{label}</div>
      <div class="display" style={{ fontSize: strong ? '1.5rem' : '1.1rem' }}>{value}</div>
    </div>
  );
}

function LogWeight({ units, onSaved }: { units: Units; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  async function submit(e: Event) {
    e.preventDefault();
    const n = num(value);
    if (n == null) return;
    try {
      await put(`/api/u/me/weights/${today()}`, { weightKg: fromDisplayWeight(n, units) });
      setValue('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }
  return (
    <form onSubmit={submit} class="stack">
      <div class="field">
        <label for="w-today">{t.weightToday} ({weightUnit(units)})</label>
        <div class="row">
          <input id="w-today" type="number" inputMode="decimal" step="0.1" min="20" value={value} onInput={(e) => setValue(e.currentTarget.value)} />
          <button class="btn" type="submit" disabled={!value}>{t.logWeight}</button>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

function GoalForm({ profile, units: initialUnits, onDone }: { profile: Profile; units: Units; onDone: () => void }) {
  const [units, setUnits] = useState<Units>(initialUnits);
  const [height, setHeight] = useState(toDisplayHeight(profile.heightCm, units)?.toString() ?? '');
  const [start, setStart] = useState(toDisplayWeight(profile.startWeightKg, units)?.toString() ?? '');
  const [target, setTarget] = useState(toDisplayWeight(profile.targetWeightKg, units)?.toString() ?? '');
  const [mode, setMode] = useState(profile.goalMode ?? 'lose');
  const [date, setDate] = useState(profile.targetDate ?? '');
  const [error, setError] = useState('');

  async function submit(e: Event) {
    e.preventDefault();
    const h = num(height);
    const s = num(start);
    const tg = num(target);
    try {
      await patch('/api/u/me/profile', {
        units,
        heightCm: h == null ? null : fromDisplayHeight(h, units),
        startWeightKg: s == null ? null : fromDisplayWeight(s, units),
        targetWeightKg: tg == null ? null : fromDisplayWeight(tg, units),
        goalMode: mode,
        targetDate: date || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <form class="stack" onSubmit={submit}>
      <fieldset>
        <legend>{t.units}</legend>
        <div class="segmented">
          {(['metric', 'imperial'] as const).map((u) => (
            <label key={u}>
              <input type="radio" name="units" checked={units === u} onChange={() => setUnits(u)} />
              <span>{t[u]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t.goalMode}</legend>
        <div class="segmented">
          {(['lose', 'maintain', 'gain'] as const).map((g) => (
            <label key={g}>
              <input type="radio" name="mode" checked={mode === g} onChange={() => setMode(g)} />
              <span>{t.goalModes[g]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div class="grid-2">
        <Field id="g-start" label={`${t.start} (${weightUnit(units)})`} value={start} set={setStart} />
        <Field id="g-target" label={`${t.target} (${weightUnit(units)})`} value={target} set={setTarget} />
        <Field id="g-height" label={`${t.height} (${heightUnit(units)})`} value={height} set={setHeight} />
        <div class="field">
          <label for="g-date">{t.targetDate}</label>
          <input id="g-date" type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <button class="btn" type="submit">{t.saveGoal}</button>
    </form>
  );
}

function Field({ id, label, value, set }: { id: string; label: string; value: string; set: (v: string) => void }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} type="number" inputMode="decimal" step="0.1" value={value} onInput={(e) => set(e.currentTarget.value)} />
    </div>
  );
}
