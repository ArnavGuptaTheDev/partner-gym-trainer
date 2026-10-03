import { useEffect, useState } from 'preact/hooks';
import { plan as t } from '../content/copy';
import { get, type Me } from '../lib/api';
import type { PlanDay, PlanExercise } from '../lib/plan';
import { dayLong, dayShort, WEEK } from '../lib/units';
import { DayHead, RestBox } from './DayBits';
import ExerciseCard from './ExerciseCard';
import PlanEditor from './PlanEditor';
import { ErrorNote, Loading, useMe, useQueryState, WhoToggle, type Who } from './ui';

export interface Meal {
  id?: string;
  name: string;
  items: string;
  notes: string;
}
export interface PlanData {
  plan: null | {
    calorieTarget: number | null;
    calorieGoal: 'deficit' | 'surplus' | 'maintain';
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    title: string;
    tagline: string;
    version: number;
    updatedAt: number;
    updatedByName: string | null;
  };
  days: PlanDay[];
  meals: Meal[];
  exercises: PlanExercise[];
  canEdit: boolean;
  warnings: string[];
}

type Tab = number | 'diet';

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

/** The day whose exercise list `weekday` shows (itself, or the day it copies). */
export const sourceDay = (days: PlanDay[], weekday: number) => days.find((d) => d.weekday === weekday)?.sameAs ?? weekday;

function PlanFor({ who, me }: { who: Who; me: Me }) {
  const [data, setData] = useState<PlanData | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [tab, setTab] = useState<Tab>(new Date().getDay());
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
        startDay={typeof tab === 'number' ? tab : 1}
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
  const lead = who === 'partner' ? t.editPartnerLead(partnerName) : me.pair && !data.canEdit ? t.readOnlyNote(partnerName) : null;

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
          {(p.title || p.tagline) && (
            <header class="plan-banner">
              {p.title && <p class="plan-title">{p.title}</p>}
              {p.tagline && <p class="plan-tagline">{p.tagline}</p>}
            </header>
          )}

          <div class="chips plan-tabs" role="group" aria-label={t.weekLabel}>
            {WEEK.map((d) => (
              <button key={d} type="button" class="chip" aria-pressed={tab === d} onClick={() => setTab(d)}>
                {dayShort(d)}
              </button>
            ))}
            <button type="button" class="chip" aria-pressed={tab === 'diet'} onClick={() => setTab('diet')}>
              {t.dietTab}
            </button>
          </div>

          {tab === 'diet' ? <DietPanel data={data} /> : <DayPanel data={data} weekday={tab} units={units} />}

          {p.updatedByName && <p class="small muted" style="margin:0">{t.setBy(p.updatedByName)} · {new Date(p.updatedAt).toLocaleDateString()}</p>}
          {data.canEdit && <button class="btn btn--block" type="button" onClick={() => setEditing(true)}>{t.edit}</button>}
        </>
      )}
    </>
  );
}

function DayPanel({ data, weekday, units }: { data: PlanData; weekday: number; units: 'metric' | 'imperial' }) {
  const day = data.days.find((d) => d.weekday === weekday);
  const src = sourceDay(data.days, weekday);
  const source = src !== weekday ? data.days.find((d) => d.weekday === src) : undefined;
  const list = data.exercises.filter((e) => e.weekday === src);
  return (
    <section class="stack" aria-label={dayLong(weekday)}>
      <DayHead weekday={weekday} day={day} source={source} />
      {day?.isRest ? (
        <RestBox message={day.restMessage} />
      ) : list.length === 0 ? (
        <RestBox message="" />
      ) : (
        list.map((e) => <ExerciseCard key={e.id} e={e} units={units} />)
      )}
    </section>
  );
}

function DietPanel({ data }: { data: PlanData }) {
  const p = data.plan!;
  return (
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
