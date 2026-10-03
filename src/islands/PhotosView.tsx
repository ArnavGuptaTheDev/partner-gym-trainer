import { useEffect, useRef, useState } from 'preact/hooks';
import { plan as planCopy, photos as t } from '../content/copy';
import { ApiError, del, type Me } from '../lib/api';
import { usePaged } from '../lib/hooks';
import { uploadPhoto, type Photo } from '../lib/photos';
import MediaPicker from './MediaPicker';
import { ErrorNote, Loading, useMe, useQueryState, WhoToggle, type Who } from './ui';

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function PhotosView() {
  const me = useMe();
  const [who, setWho] = useQueryState<Who>('who', 'me');
  if (!me) return <Loading />;
  const effective: Who = me.pair ? who : 'me';
  return (
    <div class="stack">
      <WhoToggle who={effective} onChange={setWho} me={me} mineLabel={planCopy.mine} partnerLabel={planCopy.partners} />
      <Timeline key={effective} who={effective} me={me} />
    </div>
  );
}

function Timeline({ who, me }: { who: Who; me: Me }) {
  const list = usePaged<Photo>(`/api/u/${who}/photos`, 24);
  const [open, setOpen] = useState<Photo | null>(null);
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<Photo[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const name = who === 'me' ? me.user.displayName : me.pair!.partner.displayName;

  const groups = new Map<string, Photo[]>();
  for (const p of list.items) groups.set(p.date, [...(groups.get(p.date) ?? []), p]);

  const togglePick = (p: Photo) =>
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : cur.length >= 2 ? [cur[1], p] : [...cur, p]));

  return (
    <>
      {who === 'me' && <Uploader onUploaded={(p) => list.setItems((items) => [p, ...items])} />}

      {list.items.length >= 2 && (
        <div class="spread">
          {comparing ? (
            <>
              <span class="small muted" aria-live="polite">{t.compareHint} ({picked.length}/2)</span>
              <span class="row">
                <button class="btn btn--small btn--ghost" type="button" onClick={() => { setComparing(false); setPicked([]); }}>{t.compareCancel}</button>
                <button class="btn btn--small" type="button" disabled={picked.length !== 2} onClick={() => setShowCompare(true)}>{t.compareDone}</button>
              </span>
            </>
          ) : (
            <button class="btn btn--small btn--sun" type="button" onClick={() => setComparing(true)}>↔ {t.compare}</button>
          )}
        </div>
      )}

      {list.items.length === 0 && !list.loading && (
        <div class="card empty">
          <span class="big" aria-hidden="true">📸</span>
          <p>{who === 'me' ? t.empty : t.emptyPartner(name)}</p>
        </div>
      )}

      {[...groups.entries()].map(([date, photos]) => (
        <section key={date} aria-label={fmtDay(date)}>
          <h2 class="small muted" style="font-family:var(--font-text);font-size:0.85rem;margin:8px 0">{fmtDay(date)}</h2>
          <ul class="photo-grid">
            {photos.map((p) => {
              const sel = picked.some((x) => x.id === p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    class={`photo-tile ${sel ? 'is-picked' : ''}`}
                    aria-pressed={comparing ? sel : undefined}
                    onClick={() => (comparing ? togglePick(p) : setOpen(p))}
                  >
                    <img src={p.url} alt={p.caption || t.photoAlt(name, fmtDay(p.date))} loading="lazy" width={p.width ?? undefined} height={p.height ?? undefined} />
                    {sel && <span class="pick-badge" aria-hidden="true">{picked.findIndex((x) => x.id === p.id) + 1}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <ErrorNote>{list.error}</ErrorNote>
      {list.hasMore && <button class="btn btn--ghost btn--block" type="button" onClick={list.loadMore} disabled={list.loading}>{t.loadMore}</button>}

      {open && (
        <Lightbox
          photo={open}
          alt={open.caption || t.photoAlt(name, fmtDay(open.date))}
          canDelete={who === 'me'}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            list.setItems((items) => items.filter((x) => x.id !== open.id));
            setOpen(null);
          }}
        />
      )}
      {showCompare && picked.length === 2 && (
        <Compare photos={picked} name={name} onClose={() => { setShowCompare(false); setComparing(false); setPicked([]); }} />
      )}
    </>
  );
}

function Uploader({ onUploaded }: { onUploaded: (p: Photo) => void }) {
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');

  return (
    <section class="card stack" aria-labelledby="add-photo-h">
      <h2 id="add-photo-h">{t.add}</h2>
      <MediaPicker
        confirmLabel={t.upload}
        onConfirm={async (file) => {
          setError('');
          try {
            onUploaded(await uploadPhoto(file, 'gym', caption.trim()));
            setCaption('');
          } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
            throw err;
          }
        }}
      >
        <div class="field">
          <label for="cap">{t.captionLabel}</label>
          <input id="cap" value={caption} maxLength={200} placeholder={t.captionPlaceholder} onInput={(e) => setCaption(e.currentTarget.value)} />
        </div>
      </MediaPicker>
      <ErrorNote>{error}</ErrorNote>
      <p class="small muted" style="margin:0">{t.privacyNote}</p>
    </section>
  );
}

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, []);
  return (
    <dialog ref={ref} class="modal" aria-label={label} onClick={(e) => e.target === ref.current && onClose()}>
      <div class="modal-body">
        <button class="icon-btn modal-close" type="button" onClick={onClose} aria-label={t.close}>×</button>
        {children}
      </div>
    </dialog>
  );
}

function Lightbox({ photo, alt, canDelete, onClose, onDeleted }: { photo: Photo; alt: string; canDelete: boolean; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('');
  return (
    <Modal label={alt} onClose={onClose}>
      <img src={photo.url} alt={alt} style="border-radius:var(--radius-sm);width:100%;max-height:70vh;object-fit:contain" />
      <p style="margin:10px 0 0">{photo.caption}</p>
      <p class="small muted">{fmtDay(photo.date)}</p>
      <ErrorNote>{error}</ErrorNote>
      {canDelete && (
        <button
          class="btn btn--small btn--danger"
          type="button"
          onClick={async () => {
            if (!confirm(t.deleteConfirm)) return;
            try {
              await del(`/api/u/me/photos/${photo.id}`);
              onDeleted();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {t.delete}
        </button>
      )}
    </Modal>
  );
}

function Compare({ photos, name, onClose }: { photos: Photo[]; name: string; onClose: () => void }) {
  const [before, after] = [...photos].sort((a, b) => a.createdAt - b.createdAt);
  const days = Math.round((Date.parse(after.date) - Date.parse(before.date)) / 86_400_000);
  return (
    <Modal label={`${t.before} / ${t.after}`} onClose={onClose}>
      <div class="compare">
        {[[t.before, before], [t.after, after]].map(([label, p]) => (
          <figure key={(p as Photo).id}>
            <img src={(p as Photo).url} alt={t.photoAlt(name, fmtDay((p as Photo).date))} />
            <figcaption><strong>{label as string}</strong><br /><span class="small muted">{fmtDay((p as Photo).date)}</span></figcaption>
          </figure>
        ))}
      </div>
      {days > 0 && <p class="center display" style="font-size:1.3rem;margin:12px 0 0">{days} days apart 💪</p>}
    </Modal>
  );
}
