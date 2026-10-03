import { useEffect, useState } from 'preact/hooks';
import { log as t, plan as planCopy } from '../content/copy';
import { ApiError, del, get, patch, post, today, type Me } from '../lib/api';
import { fmtWeight, fromDisplayWeight, num, toDisplayWeight, weightUnit, type Units } from '../lib/units';
import { ErrorNote, Loading, useMe, useQueryState, WhoToggle, type Who } from './ui';

interface PlannedExercise { id: string; name: string; equipment: string; sets: number | null; reps: string; targetWeightKg: number | null; notes: string }
interface ExerciseLog { id: string; planExerciseId: string | null; name: string; equipment: string; sets: number | null; reps: string; weightKg: number | null; done: boolean }
interface PlannedMeal { id: string; name: string; items: string; notes: string }
interface MealLog { id: string; planMealId: string | null; name: string; description: string; calories: number | null }
interface Day {
  date: string;
  plan: { calorieTarget: number | null; calorieGoal: string } | null;
  plannedExercises: PlannedExercise[];
  plannedMeals: PlannedMeal[];
  exercises: ExerciseLog[];
  meals: MealLog[];
  caloriesBurned: number | null;
  waterMl: number | null;
  waterTargetMl: number;
  weightKg: number | null;
  totals: { caloriesEaten: number; plannedDone: number; plannedTotal: number; exercisesDone: number };
}

const shiftDate = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + n);
  return today(dt);
};

function dateLabel(d: string) {
  if (d === today()) return t.today;
  if (d === shiftDate(today(), -1)) return t.yesterday;
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function LogView() {
  const me = useMe();
  const [who, setWho] = useQueryState<Who>('who', 'me');
  const [date, setDate] = useQueryState<string>('date', today());
  if (!me) return <Loading />;
  const effective: Who = me.pair ? who : 'me';
  return (
    <div class="stack">
      <WhoToggle who={effective} onChange={setWho} me={me} mineLabel={planCopy.mine} partnerLabel={planCopy.partners} />
      <nav class="spread card card--soft" style="padding:6px" aria-label="Choose day">
        <button class="icon-btn" type="button" aria-label={t.prevDay} onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <strong aria-live="polite">{dateLabel(date)}</strong>
        <button class="icon-btn" type="button" aria-label={t.nextDay} disabled={date >= today()} onClick={() => setDate(shiftDate(date, 1))}>›</button>
      </nav>
      <DayLog key={`${effective}-${date}`} who={effective} date={date} me={me} />
    </div>
  );
}

function DayLog({ who, date, me }: { who: Who; date: string; me: Me }) {
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState('');
  const units = me.user.units;
  const readOnly = who === 'partner';
  const base = `/api/u/me`;

  const load = () => get<Day>(`/api/u/${who}/days/${date}`).then(setDay).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  if (!day) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;

  const logByPlan = new Map(day.exercises.filter((e) => e.planExerciseId).map((e) => [e.planExerciseId!, e]));
  const extras = day.exercises.filter((e) => !e.planExerciseId);
  const target = day.plan?.calorieTarget ?? null;

  return (
    <>
      {readOnly && <p class="muted" style="margin:0">{t.partnerReadOnly(me.pair!.partner.displayName)}</p>}
      <ErrorNote>{error}</ErrorNote>

      <section class="card stack" aria-labelledby="prog-h">
        <h2 id="prog-h">{t.progressTitle}</h2>
        <Bar label={t.caloriesEaten} value={day.totals.caloriesEaten} max={target} unit="kcal" />
        <Bar label={t.workoutDone} value={day.totals.plannedDone} max={day.totals.plannedTotal || null} unit="" mint />
        <Bar label={t.water} value={day.waterMl ?? 0} max={day.waterTargetMl} unit="ml" mint />
      </section>

      <section class="card stack" aria-labelledby="wo-h">
        <h2 id="wo-h">{t.workoutTitle}</h2>
        {day.plannedExercises.length === 0 && <p class="muted" style="margin:0">{t.restDay}</p>}
        <ul class="list">
          {day.plannedExercises.map((p) => (
            <PlannedRow key={p.id} p={p} logged={logByPlan.get(p.id)} units={units} readOnly={readOnly} date={date} act={act} />
          ))}
        </ul>
        {extras.length > 0 && (
          <>
            <h3>{t.extraTitle}</h3>
            <ul class="list">
              {extras.map((e) => (
                <li key={e.id} class="spread">
                  <span>
                    <strong>{e.name}</strong>
                    <span class="small muted"> {[e.sets && `${e.sets}×${e.reps}`, e.weightKg != null && fmtWeight(e.weightKg, units)].filter(Boolean).join(' @ ')}</span>
                  </span>
                  {!readOnly && <button class="icon-btn" type="button" aria-label={`${t.remove} ${e.name}`} onClick={() => act(() => del(`${base}/exercises/${e.id}`))}>×</button>}
                </li>
              ))}
            </ul>
          </>
        )}
        {!readOnly && <QuickAdd label={t.exerciseName} button={t.addExercise} onAdd={(name) => act(() => post(`${base}/days/${date}/exercises`, { name }))} />}
      </section>

      <section class="card stack" aria-labelledby="meal-h">
        <h2 id="meal-h">{t.mealsTitle}</h2>
        <ul class="list">
          {day.plannedMeals.map((m) => {
            const logged = day.meals.find((x) => x.planMealId === m.id);
            return (
              <li key={m.id} class="stack" style="gap:6px">
                <div class="spread">
                  <span>
                    <strong>{m.name}</strong>
                    <span class="small muted" style="display:block;white-space:pre-line">{m.items}</span>
                  </span>
                  {logged ? (
                    <span class="row" style="gap:2px">
                      <span class="pill pill--ok">✓ {logged.calories != null ? `${logged.calories} kcal` : t.logged}</span>
                      {!readOnly && <button class="icon-btn" type="button" aria-label={`${t.remove} ${m.name}`} onClick={() => act(() => del(`${base}/meals/${logged.id}`))}>×</button>}
                    </span>
                  ) : (
                    !readOnly && <MealLogButton onLog={(calories) => act(() => post(`${base}/days/${date}/meals`, { planMealId: m.id, calories }))} name={m.name} />
                  )}
                </div>
              </li>
            );
          })}
          {day.meals.filter((m) => !m.planMealId || !day.plannedMeals.some((p) => p.id === m.planMealId)).map((m) => (
            <li key={m.id} class="spread">
              <span>
                <strong>{m.name}</strong> <span class="small muted">{m.calories != null ? `${m.calories} kcal` : ''}</span>
              </span>
              {!readOnly && <button class="icon-btn" type="button" aria-label={`${t.remove} ${m.name}`} onClick={() => act(() => del(`${base}/meals/${m.id}`))}>×</button>}
            </li>
          ))}
        </ul>
        {!readOnly && <CustomMeal onAdd={(name, calories) => act(() => post(`${base}/days/${date}/meals`, { name, calories }))} />}
      </section>

      <section class="card stack" aria-labelledby="body-h">
        <h2 id="body-h">{t.bodyTitle}</h2>
        {readOnly ? (
          <div class="grid-3 center small">
            <div><div class="muted">{t.water}</div><strong>{day.waterMl ?? 0} ml</strong></div>
            <div><div class="muted">{t.burned}</div><strong>{day.caloriesBurned ?? '–'}</strong></div>
            <div><div class="muted">{t.bodyWeight}</div><strong>{fmtWeight(day.weightKg, units)}</strong></div>
          </div>
        ) : (
          <BodyForm day={day} units={units} onSave={(body) => act(() => patch(`${base}/days/${date}`, body))} />
        )}
      </section>
    </>
  );
}

function Bar({ label, value, max, unit, mint }: { label: string; value: number; max: number | null; unit: string; mint?: boolean }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const text = max ? `${value.toLocaleString()} ${t.of} ${max.toLocaleString()} ${unit}` : `${value.toLocaleString()} ${unit} · ${t.noTarget}`;
  return (
    <div>
      <div class="spread small"><span>{label}</span><span class="muted">{text}</span></div>
      <div class={`progress ${mint ? 'progress--mint' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max ?? 0} aria-valuenow={value} aria-valuetext={text}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PlannedRow({ p, logged, units, readOnly, date, act }: {
  p: PlannedExercise;
  logged?: ExerciseLog;
  units: Units;
  readOnly: boolean;
  date: string;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const done = !!logged?.done;
  const [sets, setSets] = useState(String(logged?.sets ?? p.sets ?? ''));
  const [reps, setReps] = useState(logged?.reps || p.reps || '');
  const [weight, setWeight] = useState(String(toDisplayWeight(logged?.weightKg ?? p.targetWeightKg, units) ?? ''));
  const cbId = `ex-${p.id}`;

  const toggle = () => {
    if (logged) return act(() => patch(`/api/u/me/exercises/${logged.id}`, { done: !logged.done }));
    return act(() =>
      post(`/api/u/me/days/${date}/exercises`, {
        planExerciseId: p.id,
        sets: num(sets),
        reps,
        weightKg: num(weight) == null ? null : fromDisplayWeight(num(weight)!, units),
      }),
    );
  };
  const saveActuals = () =>
    logged &&
    act(() =>
      patch(`/api/u/me/exercises/${logged.id}`, {
        sets: num(sets),
        reps,
        weightKg: num(weight) == null ? null : fromDisplayWeight(num(weight)!, units),
      }),
    );

  return (
    <li class="stack" style="gap:8px">
      <div class="row" style="align-items:flex-start">
        <input id={cbId} type="checkbox" checked={done} disabled={readOnly} onChange={toggle} style="margin-top:2px" />
        <label for={cbId} style="flex:1">
          <strong style={done ? 'text-decoration:line-through;text-decoration-thickness:2px' : ''}>{p.name}</strong>
          <span class="small muted" style="display:block">
            {[p.equipment, p.sets && `${p.sets} × ${p.reps}`, p.targetWeightKg != null && fmtWeight(p.targetWeightKg, units)].filter(Boolean).join(' · ')}
          </span>
        </label>
      </div>
      {!readOnly && done && (
        <div class="grid-3" style="padding-left:32px">
          <MiniField id={`${cbId}-s`} label={t.actualSets} value={sets} set={setSets} onBlur={saveActuals} numeric />
          <MiniField id={`${cbId}-r`} label={t.actualReps} value={reps} set={setReps} onBlur={saveActuals} />
          <MiniField id={`${cbId}-w`} label={`${t.actualWeight} (${weightUnit(units)})`} value={weight} set={setWeight} onBlur={saveActuals} numeric />
        </div>
      )}
      {readOnly && logged && (
        <p class="small" style="margin:0 0 0 32px">
          {[logged.sets && `${logged.sets}×${logged.reps}`, logged.weightKg != null && fmtWeight(logged.weightKg, units)].filter(Boolean).join(' @ ')}
        </p>
      )}
    </li>
  );
}

function MiniField({ id, label, value, set, onBlur, numeric }: { id: string; label: string; value: string; set: (v: string) => void; onBlur: () => void; numeric?: boolean }) {
  return (
    <div class="field">
      <label for={id} class="small">{label}</label>
      <input id={id} value={value} type={numeric ? 'number' : 'text'} inputMode={numeric ? 'decimal' : 'text'} step="any" onInput={(e) => set(e.currentTarget.value)} onBlur={onBlur} style="min-height:40px;padding:8px 10px" />
    </div>
  );
}

function QuickAdd({ label, button, onAdd }: { label: string; button: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  const id = `qa-${label.replace(/\W/g, '')}`;
  return (
    <form class="row" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}>
      <label for={id} class="sr-only">{label}</label>
      <input id={id} value={v} maxLength={80} placeholder={label} onInput={(e) => setV(e.currentTarget.value)} />
      <button class="btn btn--ghost" type="submit" disabled={!v.trim()}>+ <span class="sr-only">{button}</span></button>
    </form>
  );
}

function MealLogButton({ name, onLog }: { name: string; onLog: (calories: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [cal, setCal] = useState('');
  if (!open) return <button class="btn btn--small btn--sun" type="button" onClick={() => setOpen(true)}>{t.logMeal}</button>;
  const id = `cal-${name.replace(/\W/g, '')}`;
  return (
    <form class="row" onSubmit={(e) => { e.preventDefault(); onLog(num(cal)); }}>
      <label for={id} class="sr-only">{`${t.mealCalories}: ${name}`}</label>
      <input id={id} type="number" inputMode="numeric" min="0" placeholder="kcal" value={cal} onInput={(e) => setCal(e.currentTarget.value)} style="width:90px" />
      <button class="btn btn--small" type="submit">✓<span class="sr-only">{t.logMeal}</span></button>
    </form>
  );
}

function CustomMeal({ onAdd }: { onAdd: (name: string, calories: number | null) => void }) {
  const [name, setName] = useState('');
  const [cal, setCal] = useState('');
  return (
    <form class="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim(), num(cal)); setName(''); setCal(''); } }}>
      <label for="cm-name" class="sr-only">{t.mealName}</label>
      <input id="cm-name" value={name} maxLength={60} placeholder={t.mealName} onInput={(e) => setName(e.currentTarget.value)} />
      <label for="cm-cal" class="sr-only">{t.mealCalories}</label>
      <input id="cm-cal" type="number" inputMode="numeric" min="0" placeholder="kcal" value={cal} onInput={(e) => setCal(e.currentTarget.value)} style="width:90px" />
      <button class="btn btn--ghost" type="submit" disabled={!name.trim()}>+<span class="sr-only">{t.addMeal}</span></button>
    </form>
  );
}

function BodyForm({ day, units, onSave }: { day: Day; units: Units; onSave: (b: Record<string, unknown>) => Promise<void> | void }) {
  const [burned, setBurned] = useState(day.caloriesBurned?.toString() ?? '');
  const [weight, setWeight] = useState(toDisplayWeight(day.weightKg, units)?.toString() ?? '');
  const water = day.waterMl ?? 0;
  return (
    <div class="stack">
      <div>
        <div class="label">{t.water}: {water} ml</div>
        <div class="row row--wrap" style="margin-top:6px">
          {[250, 500].map((ml) => (
            <button key={ml} class="btn btn--small btn--ghost" type="button" onClick={() => onSave({ waterMl: water + ml })}>💧 {t.waterAdd(ml)}</button>
          ))}
          {water > 0 && <button class="btn btn--small btn--ghost" type="button" onClick={() => onSave({ waterMl: 0 })}>{t.waterReset}</button>}
        </div>
      </div>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { caloriesBurned: num(burned) };
          const w = num(weight);
          if (w != null) body.weightKg = fromDisplayWeight(w, units);
          onSave(body);
        }}
      >
        <div class="grid-2">
          <div class="field">
            <label for="burned">{t.burned}</label>
            <input id="burned" type="number" inputMode="numeric" min="0" value={burned} onInput={(e) => setBurned(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label for="bw">{t.bodyWeight} ({weightUnit(units)})</label>
            <input id="bw" type="number" inputMode="decimal" step="0.1" min="20" value={weight} onInput={(e) => setWeight(e.currentTarget.value)} />
          </div>
        </div>
        <button class="btn" type="submit">{t.save}</button>
      </form>
    </div>
  );
}
