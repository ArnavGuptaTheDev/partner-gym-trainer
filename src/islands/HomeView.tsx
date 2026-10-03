import { useEffect, useState } from 'preact/hooks';
import { feed as f, home as t, tone as tones, type Tone } from '../content/copy';
import { confetti } from '../lib/confetti';
import { ApiError, del, get, post, put, today, type Me } from '../lib/api';
import { fmtWeight, type Units } from '../lib/units';
import PushPrompt from './PushPrompt';
import { ErrorNote, Loading, useMe } from './ui';

const REACTIONS = ['🔥', '💪', '❤️', '👏', '😍', '🤯'];

interface Activity {
  id: number;
  userId: string;
  type: string;
  summary: Record<string, any>;
  createdAt: number;
  reactions: { emoji: string; fromUserId: string }[];
}
interface TodayStats { caloriesEaten: number; calorieTarget: number | null; exercisesPlanned: number; exercisesDone: number; waterMl: number }
interface HomeData {
  date: string;
  streaks: { me: number; partner: number; shared: number; bothLoggedToday: boolean };
  noteForMe: { body: string; fromName: string } | null;
  noteForPartner: string | null;
  today: { me: TodayStats; partner: TodayStats | null };
  myActivity: Activity[];
  partnerActivity: Activity[];
  newMilestones: { kind: string; achievedAt: number }[];
}

export function describe(a: Activity, who: string, units: Units, partnerName: string, actorIsPartner: boolean): string {
  const s = a.summary;
  switch (a.type) {
    case 'workout': return f.workout(who, s.done, s.names ?? []);
    case 'meal': return f.meal(who, s.count, s.calories);
    case 'photo': return f.photo(who);
    case 'weight': return f.weight(who, fmtWeight(s.weightKg, units));
    case 'day': return f.day(who, s.waterMl, s.caloriesBurned);
    case 'plan': return s.forSelf ? f.planOwn(who) : actorIsPartner ? f.planForYou(who) : f.planForPartner(partnerName);
    case 'milestone': return f.milestone(who, t.milestoneShort[s.kind] ?? s.kind);
    default: return `${who} did something great`;
  }
}

export default function HomeView() {
  const me = useMe();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    get<HomeData>(`/api/home?date=${today()}`)
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!me || !data) return <Loading />;

  const pair = me.pair;
  const tn = tones[pair?.type ?? 'friends'];

  return (
    <div class="stack">
      <header>
        <h1>{tn.greeting(me.user.displayName)}</h1>
        <p class="muted" style="margin:0">
          {pair ? tn.homeLead : t.soloLead}
          {pair?.togetherSince && <> · <strong>{tn.daysTogether(daysSince(pair.togetherSince))}</strong></>}
        </p>
      </header>

      {data.newMilestones.length > 0 && <Celebration kinds={data.newMilestones.map((m) => m.kind)} onDone={() => setData({ ...data, newMilestones: [] })} />}

      {data.noteForMe && (
        <section class="card card--sun note" aria-label={t.noteLabel}>
          <p class="small" style="margin:0 0 4px;font-weight:700">{tn.noteFrom(data.noteForMe.fromName)}</p>
          <p class="display" style="font-size:1.25rem;margin:0;white-space:pre-line">“{data.noteForMe.body}”</p>
        </section>
      )}

      {pair && <PushPrompt partnerName={pair.partner.displayName} />}

      <Streaks data={data} tn={tn} paired={!!pair} partnerName={pair?.partner.displayName ?? ''} />

      {!pair && (
        <section class="card stack">
          <h2>{t.soloTitle}</h2>
          <p class="muted" style="margin:0">{t.soloLead}</p>
          <a class="btn" href="/settings">{t.soloCta}</a>
        </section>
      )}

      <TodayCompare me={me} data={data} tn={tn} />

      <div class="grid-2">
        <a class="btn btn--sun" href="/log">{t.logCta}</a>
        <a class="btn btn--ghost" href="/progress">{t.progressLink}</a>
      </div>

      {pair && <Nudges tn={tn} />}

      {pair && (
        <section class="card stack" aria-labelledby="pday-h">
          <h2 id="pday-h">{tn.partnerDayTitle(pair.partner.displayName)}</h2>
          {data.partnerActivity.length === 0 ? (
            <p class="muted" style="margin:0">{tn.partnerQuiet(pair.partner.displayName)}</p>
          ) : (
            <ul class="list">
              {data.partnerActivity.map((a) => (
                <FeedItem key={a.id} a={a} text={describe(a, pair.partner.displayName, me.user.units, pair.partner.displayName, true)} me={me} canReact />
              ))}
            </ul>
          )}
        </section>
      )}

      <section class="card stack" aria-labelledby="myday-h">
        <h2 id="myday-h">{t.yourDayTitle}</h2>
        {data.myActivity.length === 0 ? (
          <p class="muted" style="margin:0">{t.yourQuiet}</p>
        ) : (
          <ul class="list">
            {data.myActivity.map((a) => (
              <FeedItem key={a.id} a={a} text={describe(a, t.you, me.user.units, pair?.partner.displayName ?? '', false)} me={me} canReact={false} />
            ))}
          </ul>
        )}
      </section>

      {pair && <NoteComposer tn={tn} partnerName={pair.partner.displayName} initial={data.noteForPartner ?? ''} />}
    </div>
  );
}

function daysSince(date: string) {
  return Math.max(0, Math.round((Date.parse(today()) - Date.parse(date)) / 86_400_000));
}

function Streaks({ data, tn, paired, partnerName }: { data: HomeData; tn: Tone; paired: boolean; partnerName: string }) {
  const s = data.streaks;
  return (
    <section class="card streak-card" aria-label={paired ? tn.sharedStreak : t.streakMine}>
      <div class="streak-main">
        <span class="flame" aria-hidden="true">🔥</span>
        <div>
          <div class="big-number">{paired ? s.shared : s.me}</div>
          <div class="small">{paired ? `${tn.sharedStreak} · ${tn.sharedStreakHint}` : t.streakDays(s.me)}</div>
        </div>
      </div>
      {paired && (
        <div class="streak-split small">
          <span>{t.streakMine}: <strong>{t.streakDays(s.me)}</strong></span>
          <span>{partnerName}: <strong>{t.streakDays(s.partner)}</strong></span>
        </div>
      )}
      {s.bothLoggedToday && <p class="small" style="margin:8px 0 0">{tn.bothLogged}</p>}
    </section>
  );
}

function TodayCompare({ me, data, tn }: { me: Me; data: HomeData; tn: Tone }) {
  const cols = [{ name: t.you, s: data.today.me }];
  if (data.today.partner && me.pair) cols.push({ name: me.pair.partner.displayName, s: data.today.partner });
  const score = (s: TodayStats) => (s.exercisesPlanned ? s.exercisesDone / s.exercisesPlanned : 0) + Math.min(1, s.waterMl / 2500);
  let verdict = '';
  if (cols.length === 2) {
    const [a, b] = cols.map((c) => score(c.s));
    verdict = Math.abs(a - b) < 0.05 ? tn.tie : tn.versus(a > b ? t.you : cols[1].name);
  }
  return (
    <section class="card stack" aria-labelledby="today-h">
      <div class="spread">
        <h2 id="today-h">{t.todayTitle}</h2>
        {verdict && <span class="pill pill--accent">{verdict}</span>}
      </div>
      <div class={cols.length === 2 ? 'grid-2' : ''}>
        {cols.map(({ name, s }) => (
          <div key={name} class="stack" style="gap:8px">
            <strong>{name}</strong>
            <Mini label={t.exercises} value={s.exercisesDone} max={s.exercisesPlanned} />
            <Mini label={t.kcal} value={s.caloriesEaten} max={s.calorieTarget} />
            <Mini label={t.water} value={s.waterMl} max={2500} unit="ml" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Mini({ label, value, max, unit = '' }: { label: string; value: number; max: number | null; unit?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const text = `${value.toLocaleString()}${max ? ` / ${max.toLocaleString()}` : ''} ${unit || label}`;
  return (
    <div>
      <div class="small muted">{text}</div>
      <div class="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max ?? 0} aria-valuenow={value} aria-valuetext={text}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FeedItem({ a, text, me, canReact }: { a: Activity; text: string; me: Me; canReact: boolean }) {
  const [reactions, setReactions] = useState(a.reactions);
  const mine = (e: string) => reactions.some((r) => r.emoji === e && r.fromUserId === me.user.id);
  async function toggle(emoji: string) {
    const had = mine(emoji);
    setReactions(had ? reactions.filter((r) => !(r.emoji === emoji && r.fromUserId === me.user.id)) : [...reactions, { emoji, fromUserId: me.user.id }]);
    try {
      if (had) await del(`/api/reactions/${a.id}/${encodeURIComponent(emoji)}`);
      else await post('/api/reactions', { activityId: a.id, emoji });
    } catch {
      setReactions(a.reactions);
    }
  }
  const time = new Date(a.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <li class="stack" style="gap:6px">
      <div class="spread" style="align-items:flex-start">
        <span>{text}</span>
        <span class="small muted" style="white-space:nowrap">{time}</span>
      </div>
      {a.type === 'photo' && <img src={`/api/photos/${a.summary.photoId}`} alt={a.summary.caption || ''} loading="lazy" style="border-radius:12px;max-height:220px;object-fit:cover" />}
      {canReact ? (
        <div class="row row--wrap" role="group" aria-label="Reactions" style="gap:4px">
          {REACTIONS.map((e) => (
            <button key={e} type="button" class="chip" style="min-height:34px;padding:4px 10px" aria-pressed={mine(e)} aria-label={t.reactLabel(e)} onClick={() => toggle(e)}>{e}</button>
          ))}
        </div>
      ) : (
        reactions.length > 0 && <div class="small" aria-label="Reactions from your partner">{reactions.map((r) => r.emoji).join(' ')}</div>
      )}
    </li>
  );
}

function Nudges({ tn }: { tn: Tone }) {
  const [msg, setMsg] = useState('');
  const send = async (kind: 'proud' | 'gym') => {
    try {
      await post('/api/nudges', { kind });
      setMsg(tn.nudgeSent);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
    setTimeout(() => setMsg(''), 3000);
  };
  return (
    <section class="stack" aria-label="Nudges">
      <div class="grid-2">
        <button class="btn btn--ghost" type="button" onClick={() => send('proud')}>{tn.nudgeProud}</button>
        <button class="btn btn--ghost" type="button" onClick={() => send('gym')}>{tn.nudgeGym}</button>
      </div>
      <p class="small center muted" role="status" style="margin:0;min-height:1.2em">{msg}</p>
    </section>
  );
}

function NoteComposer({ tn, partnerName, initial }: { tn: Tone; partnerName: string; initial: string }) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState('');
  async function save(value: string) {
    setError('');
    try {
      await put(`/api/notes/${today()}`, { body: value.trim() });
      setSaved(value.trim());
      setBody(value.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  return (
    <form class="card stack" onSubmit={(e) => { e.preventDefault(); save(body); }}>
      <h2><label for="note">{tn.noteTitle(partnerName)}</label></h2>
      <textarea id="note" maxLength={280} value={body} placeholder={tn.notePlaceholder} onInput={(e) => setBody(e.currentTarget.value)} />
      <ErrorNote>{error}</ErrorNote>
      <div class="row">
        <button class="btn" type="submit" disabled={!body.trim() || body.trim() === saved}>{saved && body.trim() === saved ? t.noteSaved : t.noteSave}</button>
        {saved && <button class="btn btn--ghost" type="button" onClick={() => save('')}>{t.noteClear}</button>}
      </div>
    </form>
  );
}

function Celebration({ kinds, onDone }: { kinds: string[]; onDone: () => void }) {
  useEffect(() => {
    confetti();
  }, []);
  const close = async () => {
    await post('/api/milestones/seen').catch(() => {});
    onDone();
  };
  return (
    <section class="card celebrate stack center" role="status" aria-live="polite">
      <span class="trophy" aria-hidden="true">🏆</span>
      <h2>{t.milestoneTitle}</h2>
      {kinds.map((k) => <p key={k} style="margin:0">{t.milestones[k] ?? k}</p>)}
      <button class="btn" type="button" onClick={close}>{t.milestoneClose}</button>
    </section>
  );
}
