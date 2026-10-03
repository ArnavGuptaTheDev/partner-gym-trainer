import { useEffect, useState } from 'preact/hooks';
import { plan as t } from '../content/copy';
import { ApiError, get, put, type Me } from '../lib/api';
import { dayLong, dayShort, fromDisplayWeight, num, toDisplayWeight, WEEK, weightUnit, type Units } from '../lib/units';
import { ErrorNote, Loading, useMe, useQueryState, WhoToggle, type Who } from './ui';

interface Meal { id?: string; name: string; items: string; notes: string }
interface Exercise {
  id?: string;
  weekday: number;
  name: string;
  equipment: string;
  sets: number | null;
  reps: string;
  targetWeightKg: number | null;
  notes: string;
}
interface PlanData {
  plan: null | {
    calorieTarget: number | null;
    calorieGoal: 'deficit' | 'surplus' | 'maintain';
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    version: number;
    updatedAt: number;
    updatedByName: string | null;
  };
  meals: Meal[];
  exercises: Exercise[];
  canEdit: boolean;
  warnings: string[];
}

const todayWeekday = () => new Date().getDay();

export default function PlanView() {
  const me = useMe();
  const [who, setWho] = useQueryState<Who>('who', 'me');
  if (!me) return <Loading />;
  const effective: Who = me.pair ? who : 'me';
  return (
    <div class="stack">
      <WhoToggle who={effective} onChange={setWho} me={me} mineLabel={t.mine} partnerLabel={t.partners} />
      <PlanFor key={effective} who={effective} me={me} />
    </div>
  );
}

function PlanFor({ who, me }: { who: Who; me: Me }) {
  const [data, setData] = useState<PlanData | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [day, setDay] = useState(todayWeekday());
  const units = me.user.units;
  const partnerName = me.pair?.partner.displayName ?? '';

  const load = () =>
    get<PlanData>(`/api/u/${who}/plan`)
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [who]);

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  if (editing) {
    return (
      <PlanEditor
        data={data}
        units={units}
        who={who}
        onCancel={() => setEditing(false)}
        onSaved={(msg) => {
          setEditing(false);
          setFlash(msg);
          load();
        }}
        onConflict={() => {
          setEditing(false);
          setFlash(t.conflict);
          load();
        }}
      />
    );
  }

  const p = data.plan;
  const dayExercises = data.exercises.filter((e) => e.weekday === day);
  const lead =
    who === 'partner' ? t.editPartnerLead(partnerName) : me.pair && !data.canEdit ? t.readOnlyNote(partnerName) : null;

  return (
    <>
      {flash && <p class="alert alert--ok" role="status">{flash}</p>}
      {lead && <p class="muted" style="margin:0">{lead}</p>}

      {!p ? (
        <div class="card empty">
          <span class="big" aria-hidden="true">📝</span>
          <p>{who === 'me' ? (me.pair ? t.noPlanMine(partnerName) : t.noPlanSolo) : t.noPlan}</p>
          {data.canEdit && <button class="btn" type="button" onClick={() => setEditing(true)}>{t.create}</button>}
        </div>
      ) : (
        <>
          <section class="card stack" aria-labelledby="targets-h">
            <div class="spread">
              <h2 id="targets-h">{t.targetsTitle}</h2>
              <span class="pill pill--accent">{t.goals[p.calorieGoal]}</span>
            </div>
            <p style="margin:0">
              <span class="big-number">{p.calorieTarget?.toLocaleString() ?? '–'}</span> <span class="muted">{t.caloriesUnit}</span>
            </p>
            {data.warnings.includes('calories_low') && <p class="alert">{t.lowCalorie}</p>}
            {(p.proteinG || p.carbsG || p.fatG) && (
              <div class="grid-3 small">
                <Macro label={t.protein} value={p.proteinG} />
                <Macro label={t.carbs} value={p.carbsG} />
                <Macro label={t.fat} value={p.fatG} />
              </div>
            )}
            {p.updatedByName && <p class="small muted" style="margin:0">{t.setBy(p.updatedByName)} · {new Date(p.updatedAt).toLocaleDateString()}</p>}
          </section>

          <section class="card stack" aria-labelledby="meals-h">
            <h2 id="meals-h">{t.mealsTitle}</h2>
            {data.meals.length === 0 ? (
              <p class="muted" style="margin:0">{t.noPlan}</p>
            ) : (
              <ul class="list">
                {data.meals.map((m) => (
                  <li key={m.id}>
                    <h3>{m.name}</h3>
                    <p style="margin:0;white-space:pre-line">{m.items}</p>
                    {m.notes && <p class="small muted" style="margin:4px 0 0">{m.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section class="card stack" aria-labelledby="workout-h">
            <h2 id="workout-h">{t.workoutTitle}</h2>
            <DayChips day={day} setDay={setDay} has={(d) => data.exercises.some((e) => e.weekday === d)} />
            <h3>{dayLong(day)}</h3>
            {dayExercises.length === 0 ? (
              <p class="muted" style="margin:0">{t.restDay}</p>
            ) : (
              <ol class="list">
                {dayExercises.map((e) => (
                  <li key={e.id}>
                    <div class="spread">
                      <strong>{e.name}</strong>
                      <span class="small">
                        {[e.sets && `${e.sets} × ${e.reps || '?'}`, e.targetWeightKg != null && `${toDisplayWeight(e.targetWeightKg, units)} ${weightUnit(units)}`]
                          .filter(Boolean)
                          .join(' @ ')}
                      </span>
                    </div>
                    {e.equipment && <div class="small muted">{e.equipment}</div>}
                    {e.notes && <div class="small">{e.notes}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          {data.canEdit && <button class="btn btn--block" type="button" onClick={() => setEditing(true)}>{t.edit}</button>}
        </>
      )}
    </>
  );
}

function Macro({ label, value }: { label: string; value: number | null }) {
  return (
    <div class="card card--soft" style="padding:10px;text-align:center">
      <div class="display" style="font-size:1.3rem">{value ?? '–'}</div>
      <div class="muted">{label}</div>
    </div>
  );
}

function DayChips({ day, setDay, has }: { day: number; setDay: (d: number) => void; has: (d: number) => boolean }) {
  return (
    <div class="chips" role="group" aria-label="Day of the week">
      {WEEK.map((d) => (
        <button key={d} type="button" class="chip" aria-pressed={day === d} onClick={() => setDay(d)} aria-label={`${dayLong(d)}${has(d) ? '' : ', rest day'}`}>
          {dayShort(d)}
          {has(d) && <span class="dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

function PlanEditor({ data, units, who, onCancel, onSaved, onConflict }: {
  data: PlanData;
  units: Units;
  who: Who;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onConflict: () => void;
}) {
  const p = data.plan;
  const [calories, setCalories] = useState(p?.calorieTarget?.toString() ?? '');
  const [goal, setGoal] = useState(p?.calorieGoal ?? 'deficit');
  const [protein, setProtein] = useState(p?.proteinG?.toString() ?? '');
  const [carbs, setCarbs] = useState(p?.carbsG?.toString() ?? '');
  const [fat, setFat] = useState(p?.fatG?.toString() ?? '');
  const [meals, setMeals] = useState<Meal[]>(data.meals.length ? data.meals : [{ name: 'Breakfast', items: '', notes: '' }]);
  const [exercises, setExercises] = useState<Exercise[]>(data.exercises);
  const [day, setDay] = useState(todayWeekday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cal = num(calories);
  const lowCal = cal != null && cal > 0 && cal < 1200;

  const updMeal = (i: number, patch: Partial<Meal>) => setMeals(meals.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const moveMeal = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= meals.length) return;
    const next = [...meals];
    [next[i], next[j]] = [next[j], next[i]];
    setMeals(next);
  };

  // Exercises are edited per day; keep the global array order stable.
  const dayIdx = exercises.map((e, i) => (e.weekday === day ? i : -1)).filter((i) => i >= 0);
  const updEx = (i: number, patch: Partial<Exercise>) => setExercises(exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const moveEx = (k: number, dir: -1 | 1) => {
    const a = dayIdx[k];
    const b = dayIdx[k + dir];
    if (b === undefined) return;
    const next = [...exercises];
    [next[a], next[b]] = [next[b], next[a]];
    setExercises(next);
  };
  const copyDayTo = (target: number) => {
    const copies = exercises.filter((e) => e.weekday === day).map(({ id: _id, ...e }) => ({ ...e, weekday: target }));
    setExercises([...exercises.filter((e) => e.weekday !== target), ...copies]);
  };

  async function save(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await put(`/api/u/${who}/plan`, {
        version: p?.version ?? 0,
        calorieTarget: cal != null ? Math.round(cal) : null,
        calorieGoal: goal,
        proteinG: num(protein),
        carbsG: num(carbs),
        fatG: num(fat),
        meals: meals.filter((m) => m.name.trim()).map((m) => ({ id: m.id, name: m.name, items: m.items, notes: m.notes })),
        exercises: exercises
          .filter((x) => x.name.trim())
          .map((x) => ({
            id: x.id,
            weekday: x.weekday,
            name: x.name,
            equipment: x.equipment,
            sets: x.sets,
            reps: x.reps,
            targetWeightKg: x.targetWeightKg,
            notes: x.notes,
          })),
      });
      onSaved(t.saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return onConflict();
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form class="stack" onSubmit={save}>
      <section class="card stack" aria-labelledby="ed-targets">
        <h2 id="ed-targets">{t.targetsTitle}</h2>
        <div class="field">
          <label for="cal">{t.calories} ({t.caloriesUnit})</label>
          <input id="cal" type="number" inputMode="numeric" min={0} max={10000} step={10} value={calories} onInput={(e) => setCalories(e.currentTarget.value)} aria-describedby={lowCal ? 'cal-warn' : undefined} />
        </div>
        {lowCal && <p class="alert" id="cal-warn" role="status">{t.lowCalorie}</p>}
        <fieldset>
          <legend>{t.goal}</legend>
          <div class="segmented">
            {(['deficit', 'maintain', 'surplus'] as const).map((g) => (
              <label key={g}>
                <input type="radio" name="goal" checked={goal === g} onChange={() => setGoal(g)} />
                <span>{t.goals[g]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div class="grid-3">
          <NumField id="pro" label={t.protein} value={protein} set={setProtein} />
          <NumField id="carb" label={t.carbs} value={carbs} set={setCarbs} />
          <NumField id="fat" label={t.fat} value={fat} set={setFat} />
        </div>
      </section>

      <section class="card stack" aria-labelledby="ed-meals">
        <h2 id="ed-meals">{t.mealsTitle}</h2>
        {meals.map((m, i) => (
          <fieldset class="editor-item stack" key={m.id ?? `new-${i}`}>
            <legend class="sr-only">{`${t.mealName} ${i + 1}`}</legend>
            <div class="field">
              <label for={`m-name-${i}`}>{t.mealName}</label>
              <input id={`m-name-${i}`} value={m.name} maxLength={60} onInput={(e) => updMeal(i, { name: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label for={`m-items-${i}`}>{t.mealItems}</label>
              <textarea id={`m-items-${i}`} value={m.items} maxLength={1000} onInput={(e) => updMeal(i, { items: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label for={`m-notes-${i}`}>{t.notes}</label>
              <input id={`m-notes-${i}`} value={m.notes} maxLength={500} onInput={(e) => updMeal(i, { notes: e.currentTarget.value })} />
            </div>
            <ItemActions label={m.name || `${t.mealName} ${i + 1}`} onUp={() => moveMeal(i, -1)} onDown={() => moveMeal(i, 1)} onRemove={() => setMeals(meals.filter((_, j) => j !== i))} />
          </fieldset>
        ))}
        {meals.length < 12 && (
          <button class="btn btn--ghost" type="button" onClick={() => setMeals([...meals, { name: '', items: '', notes: '' }])}>+ {t.addMeal}</button>
        )}
      </section>

      <section class="card stack" aria-labelledby="ed-workout">
        <h2 id="ed-workout">{t.workoutTitle}</h2>
        <DayChips day={day} setDay={setDay} has={(d) => exercises.some((e) => e.weekday === d)} />
        <h3>{dayLong(day)}</h3>
        {dayIdx.map((i, k) => {
          const x = exercises[i];
          return (
            <fieldset class="editor-item stack" key={x.id ?? `new-${i}`}>
              <legend class="sr-only">{`${t.exercise} ${k + 1}`}</legend>
              <div class="field">
                <label for={`x-name-${i}`}>{t.exercise}</label>
                <input id={`x-name-${i}`} value={x.name} maxLength={80} placeholder="Squat" onInput={(e) => updEx(i, { name: e.currentTarget.value })} />
              </div>
              <div class="field">
                <label for={`x-eq-${i}`}>{t.equipment}</label>
                <input id={`x-eq-${i}`} value={x.equipment} maxLength={80} placeholder="Smith machine" onInput={(e) => updEx(i, { equipment: e.currentTarget.value })} />
              </div>
              <div class="grid-3">
                <NumField id={`x-sets-${i}`} label={t.sets} value={x.sets?.toString() ?? ''} set={(v) => updEx(i, { sets: num(v) })} />
                <div class="field">
                  <label for={`x-reps-${i}`}>{t.reps}</label>
                  <input id={`x-reps-${i}`} value={x.reps} maxLength={20} placeholder="8-12" onInput={(e) => updEx(i, { reps: e.currentTarget.value })} />
                </div>
                <NumField
                  id={`x-w-${i}`}
                  label={`${t.targetWeight} (${weightUnit(units)})`}
                  value={toDisplayWeight(x.targetWeightKg, units)?.toString() ?? ''}
                  step={0.5}
                  set={(v) => {
                    const n = num(v);
                    updEx(i, { targetWeightKg: n == null ? null : fromDisplayWeight(n, units) });
                  }}
                />
              </div>
              <div class="field">
                <label for={`x-notes-${i}`}>{t.notes}</label>
                <input id={`x-notes-${i}`} value={x.notes} maxLength={500} onInput={(e) => updEx(i, { notes: e.currentTarget.value })} />
              </div>
              <ItemActions label={x.name || `${t.exercise} ${k + 1}`} onUp={() => moveEx(k, -1)} onDown={() => moveEx(k, 1)} onRemove={() => setExercises(exercises.filter((_, j) => j !== i))} />
            </fieldset>
          );
        })}
        {dayIdx.length === 0 && <p class="muted" style="margin:0">{t.restDay}</p>}
        <button
          class="btn btn--ghost"
          type="button"
          onClick={() => setExercises([...exercises, { weekday: day, name: '', equipment: '', sets: 3, reps: '10', targetWeightKg: null, notes: '' }])}
        >
          + {t.addExercise}
        </button>
        {dayIdx.length > 0 && (
          <div class="field">
            <label for="copy-day">{t.copyDay}</label>
            <select id="copy-day" value="" onChange={(e) => { const v = e.currentTarget.value; if (v !== '') copyDayTo(Number(v)); e.currentTarget.value = ''; }}>
              <option value="">—</option>
              {WEEK.filter((d) => d !== day).map((d) => (
                <option key={d} value={d}>{dayLong(d)}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      <ErrorNote>{error}</ErrorNote>
      <div class="sticky-actions">
        <button class="btn btn--ghost" type="button" onClick={onCancel}>{t.cancel}</button>
        <button class="btn" type="submit" disabled={saving}>{saving ? t.saving : t.save}</button>
      </div>
    </form>
  );
}

function NumField({ id, label, value, set, step = 1 }: { id: string; label: string; value: string; set: (v: string) => void; step?: number }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} type="number" inputMode="decimal" min={0} step={step} value={value} onInput={(e) => set(e.currentTarget.value)} />
    </div>
  );
}

function ItemActions({ label, onUp, onDown, onRemove }: { label: string; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <div class="row">
      <button class="icon-btn" type="button" onClick={onUp} aria-label={`${t.moveUp}: ${label}`}>↑</button>
      <button class="icon-btn" type="button" onClick={onDown} aria-label={`${t.moveDown}: ${label}`}>↓</button>
      <button class="btn btn--small btn--danger" type="button" onClick={onRemove} style="margin-left:auto">{t.remove}</button>
    </div>
  );
}
