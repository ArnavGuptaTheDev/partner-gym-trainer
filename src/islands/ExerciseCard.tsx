// An exercise as the person doing the workout sees it: pictogram or photo,
// name, muscles, coach's note, sets×reps, and photos/videos that expand
// inline. Log controls (check-off, actual sets) go in `children`.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { youtubeEmbed, youtubeId, youtubeThumb } from '../../shared/plan';
import { exerciseCard as t } from '../content/copy';
import { setsRepsLabel, type PlanExercise } from '../lib/plan';
import { fmtWeight, type Units } from '../lib/units';
import ExerciseIcon from './ExerciseIcon';

type CardExercise = Pick<
  PlanExercise,
  'name' | 'altName' | 'muscles' | 'notes' | 'equipment' | 'sets' | 'repsMin' | 'repsMax' | 'repsSuffix' | 'reps' | 'targetWeightKg' | 'icon' | 'links' | 'media'
>;

export default function ExerciseCard({ e, units, children, done }: { e: CardExercise; units: Units; children?: ComponentChildren; done?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = setsRepsLabel(e);
  const mediaCount = e.media.length + e.links.length;
  const extra = [e.equipment, e.targetWeightKg != null ? `${t.target} ${fmtWeight(e.targetWeightKg, units)}` : ''].filter(Boolean).join(' · ');
  const panelId = `media-${e.name.replace(/\W+/g, '-')}-${Math.abs(hash(e.name + e.notes))}`;

  return (
    <article class={`ex-card ${done ? 'is-done' : ''}`}>
      <div class="ex-main">
        <div class="ex-badge" aria-hidden="true">
          {e.media[0] ? (
            <img src={e.media[0].url} alt="" loading="lazy" />
          ) : e.icon ? (
            <ExerciseIcon name={e.icon} />
          ) : (
            <span class="ex-initial">{e.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div class="ex-body">
          <h3>
            {e.name}
            {e.altName && <span class="ex-alt"> {t.or(e.altName)}</span>}
          </h3>
          {e.muscles && <div class="ex-meta">{e.muscles}</div>}
          {e.notes && <div class="ex-note">{e.notes}</div>}
          {extra && <div class="ex-note">{extra}</div>}
        </div>
        {label && (
          <div class="ex-sets">
            <div class="n">{label}</div>
            <div class="l">{e.sets && (e.repsMin != null || e.reps) ? t.setsReps : ''}</div>
          </div>
        )}
      </div>

      {mediaCount > 0 && (
        <button class="ex-media-toggle" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {t.media(e.media.length, e.links.length)}
        </button>
      )}
      {open && (
        <div class="ex-media stack" id={panelId}>
          {e.media.map((m) => (
            <img key={m.id} src={m.url} alt={t.photoAlt(e.name)} loading="lazy" width={m.width ?? undefined} height={m.height ?? undefined} />
          ))}
          {e.links.map((url) => {
            const yt = youtubeId(url);
            return yt ? <YouTube key={url} id={yt} title={e.name} /> : <ExternalLink key={url} url={url} />;
          })}
        </div>
      )}
      {children}
    </article>
  );
}

/** Thumbnail first; the nocookie player only loads after a tap. */
function YouTube({ id, title }: { id: string; title: string }) {
  const [play, setPlay] = useState(false);
  if (play) {
    return (
      <div class="yt-frame">
        <iframe
          src={youtubeEmbed(id)}
          title={t.videoTitle(title)}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          // YouTube's player needs a referrer; the site default is same-origin.
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
    );
  }
  return (
    <button class="yt-thumb" type="button" onClick={() => setPlay(true)} aria-label={t.playVideo(title)}>
      <img src={youtubeThumb(id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <span class="yt-play" aria-hidden="true">▶</span>
    </button>
  );
}

function ExternalLink({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* keep raw */
  }
  return (
    <a class="ex-link" href={url} target="_blank" rel="noopener noreferrer">
      {host} <span aria-hidden="true">↗</span>
      <span class="sr-only"> {t.opensNewTab}</span>
    </a>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
