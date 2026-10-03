import { useRef, useState } from 'preact/hooks';
import { EXERCISE_ICONS, MAX_EXERCISE_LINKS, MAX_EXERCISE_PHOTOS, safeHttpUrl, type ExerciseIcon as IconName } from '../../shared/plan';
import { plan as t } from '../content/copy';
import { ApiError, put } from '../lib/api';
import { parseLegacyReps, setsRepsLabel, uploadPlanMedia, type PlanDay, type PlanExercise } from '../lib/plan';
import { dayLong, dayShort, fromDisplayWeight, num, toDisplayWeight, WEEK, weightUnit, type Units } from '../lib/units';
import ExerciseIcon, { ICON_LABELS } from './ExerciseIcon';
import MediaPicker from './MediaPicker';
import DietEditor, { dietBody, initialDiet } from './DietEditor';
import type { PlanData } from './PlanView';
import { ErrorNote, type Who } from './ui';

type Mode = 'workout' | 'same' | 'rest';
interface DayState {
  title: string;
  note: string;
  mode: Mode;
  sameAs: number | null;
  restMessage: string;
}
/** Editor copy of an exercise; `key` is stable across reorders. */
type EditEx = PlanExercise & { key: string };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function toEditable(e: PlanExercise): EditEx {
  // Older rows only have free-text reps; split them into fields when we can.
  if (e.repsMin == null && e.reps) {
    const parsed = parseLegacyReps(e.reps);
    return { ...e, ...(parsed ?? { repsMin: null, repsMax: null, repsSuffix: e.reps }), key: newKey() };
  }
  return { ...e, key: newKey() };
}

function blankExercise(weekday: number): EditEx {
  return {
    key: newKey(), weekday, name: '', altName: '', muscles: '', notes: '', equipment: '', sets: 3,
    repsMin: 10, repsMax: null, repsSuffix: '', reps: '', targetWeightKg: null, icon: null, links: [], media: [],
  };
}

function initialDays(days: PlanDay[]): Record<number, DayState> {
  const out: Record<number, DayState> = {};
  for (const d of WEEK) {
    const row = days.find((x) => x.weekday === d);
    out[d] = {
      title: row?.title ?? '',
      note: row?.note ?? '',
      mode: row?.isRest ? 'rest' : row?.sameAs != null ? 'same' : 'workout',
      sameAs: row?.sameAs ?? null,
      restMessage: row?.restMessage ?? '',
    };
  }
  return out;
}

export default function PlanEditor({ data, units, who, startDay, onCancel, onSaved, onConflict }: {
  data: PlanData;
  units: Units;
  who: Who;
  startDay: number;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onConflict: () => void;
}) {
  const p = data.plan;
  const [title, setTitle] = useState(p?.title ?? '');
  const [tagline, setTagline] = useState(p?.tagline ?? '');
  const [calories, setCalories] = useState(p?.calorieTarget?.toString() ?? '');
  const [goal, setGoal] = useState(p?.calorieGoal ?? 'deficit');
  const [protein, setProtein] = useState(p?.proteinG?.toString() ?? '');
  const [carbs, setCarbs] = useState(p?.carbsG?.toString() ?? '');
  const [fat, setFat] = useState(p?.fatG?.toString() ?? '');
  const [diet, setDiet] = useState(() => initialDiet(data.meals, p));
  const [days, setDays] = useState(() => initialDays(data.days));
  const [exercises, setExercises] = useState<EditEx[]>(() => data.exercises.map(toEditable));
  const [day, setDay] = useState(startDay);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const cal = num(calories);
  const lowCal = cal != null && cal > 0 && cal < 1200;
  const ds = days[day];
  const dependents = WEEK.filter((d) => days[d].mode === 'same' && days[d].sameAs === day);
  const dayIdx = exercises.map((e, i) => (e.weekday === day ? i : -1)).filter((i) => i >= 0);

  const setDay_ = (patch: Partial<DayState>) => setDays({ ...days, [day]: { ...ds, ...patch } });

  function setMode(mode: Mode) {
    if (mode !== 'workout' && dayIdx.length && !confirm(t.modeDropsExercises(dayLong(day), dayIdx.length))) return;
    if (mode !== 'workout') setExercises(exercises.filter((e) => e.weekday !== day));
    const firstWorkout = WEEK.find((d) => d !== day && days[d].mode === 'workout') ?? null;
    setDay_({ mode, sameAs: mode === 'same' ? (ds.sameAs ?? firstWorkout) : null });
  }

  const updEx = (key: string, patch: Partial<EditEx>) => setExercises((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /** Moves the item at global index `from` to the slot of global index `to`. */
  const moveTo = (from: number, to: number) =>
    setExercises((xs) => {
      const next = [...xs];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  const moveBy = (k: number, dir: -1 | 1) => {
    const a = dayIdx[k];
    const b = dayIdx[k + dir];
    if (b === undefined) return;
    moveTo(a, b);
    setStatus(t.moved(exercises[a].name || t.exercise, k + dir + 1, dayIdx.length));
  };

  function duplicate(k: number) {
    const src = exercises[dayIdx[k]];
    // Photos belong to one exercise, so copies keep links but not photos.
    const copy: EditEx = { ...src, id: undefined, key: newKey(), media: [], name: src.name ? `${src.name} ${t.copySuffix}` : '' };
    const next = [...exercises];
    next.splice(dayIdx[k] + 1, 0, copy);
    setExercises(next);
    setOpenKey(copy.key);
  }

  function copyDayTo(target: number) {
    const tgt = days[target];
    if (tgt.mode !== 'workout' && !confirm(t.copyOverridesMode(dayLong(target)))) return;
    const existing = exercises.filter((e) => e.weekday === target).length;
    if (existing && !confirm(t.copyReplaces(dayLong(target), existing))) return;
    const copies = exercises
      .filter((e) => e.weekday === day)
      .map((e) => ({ ...e, id: undefined, key: newKey(), weekday: target, media: [] as PlanExercise['media'] }));
    setExercises([...exercises.filter((e) => e.weekday !== target), ...copies]);
    setDays({ ...days, [target]: { ...tgt, mode: 'workout', sameAs: null, title: ds.title, note: ds.note } });
    setStatus(t.copied(dayLong(day), dayLong(target)));
  }

  function buildBody() {
    const badLink = exercises.find((e) => e.links.some((l) => l.trim() && !safeHttpUrl(l)));
    if (badLink) throw new Error(t.badLink(badLink.name || t.exercise));
    return {
      version: p?.version ?? 0,
      title: title.trim(),
      tagline: tagline.trim(),
      calorieTarget: cal != null ? Math.round(cal) : null,
      calorieGoal: goal,
      proteinG: num(protein),
      carbsG: num(carbs),
      fatG: num(fat),
      days: WEEK.map((d) => ({ d, s: days[d] }))
        .filter(({ s }) => s.title || s.note || s.mode !== 'workout')
        .map(({ d, s }) => ({
          weekday: d,
          title: s.title.trim(),
          note: s.note.trim(),
          isRest: s.mode === 'rest',
          restMessage: s.mode === 'rest' ? s.restMessage.trim() : '',
          sameAs: s.mode === 'same' ? s.sameAs : null,
        })),
      ...dietBody(diet),
      exercises: exercises
        .filter((e) => e.name.trim() && days[e.weekday].mode === 'workout')
        .map((e) => ({
          id: e.id,
          weekday: e.weekday,
          name: e.name.trim(),
          altName: e.altName.trim(),
          muscles: e.muscles.trim(),
          notes: e.notes.trim(),
          equipment: e.equipment.trim(),
          sets: e.sets,
          repsMin: e.repsMin,
          repsMax: e.repsMin != null ? e.repsMax : null,
          repsSuffix: e.repsSuffix.trim(),
          // Text-only reps (e.g. "AMRAP") keep working as before.
          reps: e.repsMin == null ? e.repsSuffix.trim() : undefined,
          targetWeightKg: e.targetWeightKg,
          icon: e.icon,
          links: e.links.map((l) => l.trim()).filter(Boolean),
          mediaIds: e.media.map((m) => m.id),
        })),
    };
  }

  async function save(ev: Event) {
    ev.preventDefault();
    setError('');
    let body;
    try {
      body = buildBody();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setSaving(true);
    try {
      await put(`/api/u/${who}/plan`, body);
      onSaved(t.saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return onConflict();
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form class="stack" onSubmit={save}>
      <section class="card stack" aria-labelledby="ed-header">
        <h2 id="ed-header">{t.headerTitle}</h2>
        <TextField id="plan-title" label={t.planTitle} value={title} set={setTitle} max={60} placeholder={t.planTitlePlaceholder} />
        <TextField id="plan-tagline" label={t.planTagline} value={tagline} set={setTagline} max={140} placeholder={t.planTaglinePlaceholder} />
      </section>

      <section class="card stack" aria-labelledby="ed-workout">
        <h2 id="ed-workout">{t.workoutTitle}</h2>
        <div class="chips" role="group" aria-label={t.weekLabel}>
          {WEEK.map((d) => (
            <button key={d} type="button" class="chip" aria-pressed={day === d} onClick={() => setDay(d)}>
              {dayShort(d)}
              {days[d].mode === 'rest' ? ' 🛌' : days[d].mode === 'same' ? ' =' : exercises.some((e) => e.weekday === d) ? <span class="dot" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <h3>{dayLong(day)}</h3>

        <TextField id="day-title" label={t.dayTitle} value={ds.title} set={(v) => setDay_({ title: v })} max={60} placeholder={t.dayTitlePlaceholder} />
        <div class="field">
          <label for="day-note">{t.dayNote}</label>
          <textarea id="day-note" maxLength={500} value={ds.note} placeholder={t.dayNotePlaceholder} onInput={(e) => setDay_({ note: e.currentTarget.value })} />
        </div>

        <fieldset>
          <legend>{t.dayType}</legend>
          <div class="segmented">
            {(['workout', 'same', 'rest'] as const).map((m) => (
              <label key={m}>
                <input type="radio" name="day-mode" checked={ds.mode === m} disabled={m !== 'workout' && dependents.length > 0} onChange={() => setMode(m)} />
                <span>{t.modes[m]}</span>
              </label>
            ))}
          </div>
          {dependents.length > 0 && <p class="small muted" style="margin:6px 0 0">{t.hasDependents(dependents.map(dayLong).join(', '))}</p>}
        </fieldset>

        {ds.mode === 'same' && (
          <div class="field">
            <label for="same-as">{t.sameAsLabel}</label>
            <select id="same-as" value={ds.sameAs ?? ''} onChange={(e) => setDay_({ sameAs: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}>
              {WEEK.filter((d) => d !== day && days[d].mode === 'workout').map((d) => (
                <option key={d} value={d}>{dayLong(d)}{days[d].title ? ` · ${days[d].title}` : ''}</option>
              ))}
            </select>
            <span class="hint">{t.sameAsHint}</span>
          </div>
        )}

        {ds.mode === 'rest' && (
          <div class="field">
            <label for="rest-msg">{t.restMessage}</label>
            <textarea id="rest-msg" maxLength={1000} value={ds.restMessage} placeholder={t.restDefault} onInput={(e) => setDay_({ restMessage: e.currentTarget.value })} />
          </div>
        )}

        {ds.mode === 'workout' && (
          <>
            <p class="sr-only" aria-live="polite">{status}</p>
            <ExerciseList
              items={dayIdx.map((i) => exercises[i])}
              globalIdx={dayIdx}
              units={units}
              who={who}
              openKey={openKey}
              setOpenKey={setOpenKey}
              update={updEx}
              remove={(key) => setExercises(exercises.filter((x) => x.key !== key))}
              moveBy={moveBy}
              moveTo={moveTo}
              duplicate={duplicate}
            />
            <button
              class="btn btn--ghost"
              type="button"
              onClick={() => {
                const ex = blankExercise(day);
                setExercises([...exercises, ex]);
                setOpenKey(ex.key);
              }}
            >
              + {t.addExercise}
            </button>
            {dayIdx.length > 0 && (
              <div class="field">
                <label for="copy-day">{t.copyDay}</label>
                <select id="copy-day" value="" onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v !== '') copyDayTo(Number(v)); }}>
                  <option value="">—</option>
                  {WEEK.filter((d) => d !== day && !(days[d].mode === 'same' && days[d].sameAs === day)).map((d) => (
                    <option key={d} value={d}>{dayLong(d)}</option>
                  ))}
                </select>
                <span class="hint">{t.copyDayHint}</span>
              </div>
            )}
          </>
        )}
      </section>

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

      <DietEditor diet={diet} set={setDiet} />

      <ErrorNote>{error}</ErrorNote>
      <div class="sticky-actions">
        <button class="btn btn--ghost" type="button" onClick={onCancel}>{t.cancel}</button>
        <button class="btn" type="submit" disabled={saving}>{saving ? t.saving : t.save}</button>
      </div>
    </form>
  );
}

function ExerciseList({ items, globalIdx, units, who, openKey, setOpenKey, update, remove, moveBy, moveTo, duplicate }: {
  items: EditEx[];
  globalIdx: number[];
  units: Units;
  who: Who;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  update: (key: string, patch: Partial<EditEx>) => void;
  remove: (key: string) => void;
  moveBy: (k: number, dir: -1 | 1) => void;
  moveTo: (from: number, to: number) => void;
  duplicate: (k: number) => void;
}) {
  // Pointer-based drag (works with touch and mouse); buttons cover keyboards.
  const dragging = useRef<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const onPointerDown = (key: string) => (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = key;
    setDragKey(key);
  };
  const onPointerMove = (e: PointerEvent) => {
    const key = dragging.current;
    if (!key) return;
    const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-ex-key]');
    const overKey = over?.dataset.exKey;
    if (!overKey || overKey === key) return;
    const from = items.findIndex((x) => x.key === key);
    const to = items.findIndex((x) => x.key === overKey);
    if (from >= 0 && to >= 0) moveTo(globalIdx[from], globalIdx[to]);
  };
  const onPointerUp = () => {
    dragging.current = null;
    setDragKey(null);
  };

  if (!items.length) return <p class="muted" style="margin:0">{t.noExercisesYet}</p>;
  return (
    <ol class="ex-edit-list">
      {items.map((x, k) => {
        const open = openKey === x.key;
        return (
          <li key={x.key} data-ex-key={x.key} class={`editor-item ${dragKey === x.key ? 'is-dragging' : ''}`}>
            <div class="row">
              <button
                type="button"
                class="icon-btn drag-handle"
                aria-label={t.dragHandle(x.name || t.exercise)}
                title={t.dragHint}
                onPointerDown={onPointerDown(x.key)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                ⠿
              </button>
              <button type="button" class="ex-edit-summary" aria-expanded={open} onClick={() => setOpenKey(open ? null : x.key)}>
                <strong>{x.name || t.untitled}</strong>
                <span class="small muted"> {setsRepsLabel(x)}</span>
              </button>
              <button class="icon-btn" type="button" onClick={() => moveBy(k, -1)} disabled={k === 0} aria-label={`${t.moveUp}: ${x.name || t.exercise}`}>↑</button>
              <button class="icon-btn" type="button" onClick={() => moveBy(k, 1)} disabled={k === items.length - 1} aria-label={`${t.moveDown}: ${x.name || t.exercise}`}>↓</button>
            </div>
            {open && <ExerciseFields x={x} units={units} who={who} update={(patch) => update(x.key, patch)} />}
            {open && (
              <div class="row">
                <button class="btn btn--small btn--ghost" type="button" onClick={() => duplicate(k)}>{t.duplicate}</button>
                <button class="btn btn--small btn--danger" type="button" onClick={() => remove(x.key)} style="margin-left:auto">{t.remove}</button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ExerciseFields({ x, units, who, update }: { x: EditEx; units: Units; who: Who; update: (p: Partial<EditEx>) => void }) {
  const [uploadError, setUploadError] = useState('');
  const id = (f: string) => `${x.key}-${f}`;
  return (
    <div class="stack" style="margin-top:12px">
      <TextField id={id('name')} label={t.exercise} value={x.name} max={80} set={(v) => update({ name: v })} placeholder="Push-ups" />
      <TextField id={id('alt')} label={t.altName} value={x.altName} max={80} set={(v) => update({ altName: v })} placeholder="Bench Press" hint={t.altNameHint} />
      <TextField id={id('muscles')} label={t.muscles} value={x.muscles} max={120} set={(v) => update({ muscles: v })} placeholder={t.musclesPlaceholder} />
      <div class="field">
        <label for={id('notes')}>{t.coachNote}</label>
        <textarea id={id('notes')} maxLength={500} value={x.notes} placeholder={t.coachNotePlaceholder} onInput={(e) => update({ notes: e.currentTarget.value })} />
      </div>
      <div class="grid-2">
        <NumField id={id('sets')} label={t.sets} value={x.sets?.toString() ?? ''} set={(v) => update({ sets: num(v) })} />
        <TextField id={id('suffix')} label={t.repsSuffix} value={x.repsSuffix} max={20} set={(v) => update({ repsSuffix: v })} placeholder={t.repsSuffixPlaceholder} />
        <NumField id={id('rmin')} label={t.repsMin} value={x.repsMin?.toString() ?? ''} set={(v) => update({ repsMin: num(v) })} />
        <NumField id={id('rmax')} label={t.repsMax} value={x.repsMax?.toString() ?? ''} set={(v) => update({ repsMax: num(v) })} />
      </div>
      <p class="small muted" style="margin:0" aria-live="polite">{t.preview}: <strong>{setsRepsLabel(x) || '—'}</strong></p>
      <div class="grid-2">
        <TextField id={id('eq')} label={t.equipment} value={x.equipment} max={80} set={(v) => update({ equipment: v })} placeholder="Smith machine" />
        <NumField
          id={id('w')}
          label={`${t.targetWeight} (${weightUnit(units)})`}
          value={toDisplayWeight(x.targetWeightKg, units)?.toString() ?? ''}
          step={0.5}
          set={(v) => {
            const n = num(v);
            update({ targetWeightKg: n == null ? null : fromDisplayWeight(n, units) });
          }}
        />
      </div>

      <fieldset>
        <legend>{t.icon}</legend>
        <div class="icon-picker">
          <button type="button" class="icon-choice" aria-pressed={x.icon === null} onClick={() => update({ icon: null })}>
            <span class="small">{t.noIcon}</span>
          </button>
          {EXERCISE_ICONS.map((name: IconName) => (
            <button key={name} type="button" class="icon-choice" aria-pressed={x.icon === name} aria-label={ICON_LABELS[name]} title={ICON_LABELS[name]} onClick={() => update({ icon: name })}>
              <ExerciseIcon name={name} size={40} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="stack">
        <legend>{t.links}</legend>
        {x.links.map((l, i) => (
          <div class="row" key={i}>
            <label class="sr-only" for={id(`link${i}`)}>{`${t.link} ${i + 1}`}</label>
            <input
              id={id(`link${i}`)}
              type="url"
              inputMode="url"
              value={l}
              placeholder="https://youtu.be/…"
              aria-invalid={l.trim() !== '' && !safeHttpUrl(l)}
              onInput={(e) => { const v = e.currentTarget.value; update({ links: x.links.map((y, j) => (j === i ? v : y)) }); }}
            />
            <button class="icon-btn" type="button" aria-label={`${t.remove} ${t.link} ${i + 1}`} onClick={() => update({ links: x.links.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        {x.links.length < MAX_EXERCISE_LINKS && (
          <button class="btn btn--small btn--ghost" type="button" style="align-self:flex-start" onClick={() => update({ links: [...x.links, ''] })}>+ {t.addLink}</button>
        )}
        <span class="hint">{t.linksHint}</span>
      </fieldset>

      <fieldset class="stack">
        <legend>{t.photos}</legend>
        {x.media.length > 0 && (
          <ul class="photo-grid">
            {x.media.map((m) => (
              <li key={m.id} style="position:relative">
                <img src={m.url} alt={t.photoOf(x.name || t.exercise)} style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px" />
                <button class="icon-btn media-remove" type="button" aria-label={t.removePhoto} onClick={() => update({ media: x.media.filter((y) => y.id !== m.id) })}>×</button>
              </li>
            ))}
          </ul>
        )}
        {x.media.length < MAX_EXERCISE_PHOTOS && (
          <MediaPicker
            onConfirm={async (file) => {
              setUploadError('');
              try {
                const m = await uploadPlanMedia(file, who);
                update({ media: [...x.media, m] });
              } catch (e) {
                setUploadError(e instanceof Error ? e.message : String(e));
                throw e;
              }
            }}
          />
        )}
        <ErrorNote>{uploadError}</ErrorNote>
        <span class="hint">{t.photosHint}</span>
      </fieldset>
    </div>
  );
}

function TextField({ id, label, value, set, max, placeholder, hint }: { id: string; label: string; value: string; set: (v: string) => void; max: number; placeholder?: string; hint?: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} value={value} maxLength={max} placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined} onInput={(e) => set(e.currentTarget.value)} />
      {hint && <span class="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
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
