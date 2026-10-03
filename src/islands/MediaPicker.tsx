// Photo source picker. Phones get "Take photo" (file input with
// capture="environment", which opens the system camera app: no
// getUserMedia, no permission prompt) and "Choose from gallery". Desktops,
// where capture is ignored, get a single "Add photo". Either way the user
// previews the shot and confirms or retakes before anything uploads.
import { useEffect, useRef, useState } from 'preact/hooks';
import { mediaPicker as t } from '../content/copy';

interface Props {
  /** Receives the original file; compression/upload happen in the caller. */
  onConfirm: (file: File) => Promise<void>;
  disabled?: boolean;
  /** Button text overrides, e.g. for chat. */
  addLabel?: string;
  /** Compact icon-style buttons (chat composer). */
  compact?: boolean;
}

export function useIsTouchDevice() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = matchMedia('(pointer: coarse)');
    setTouch(mq.matches);
    const on = () => setTouch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return touch;
}

export default function MediaPicker({ onConfirm, disabled, addLabel, compact }: Props) {
  const touch = useIsTouchDevice();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<'camera' | 'gallery'>('gallery');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (from: 'camera' | 'gallery') => (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = ''; // allow choosing the same file again after a retake
    if (!f) return;
    setSource(from);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const clear = () => {
    setFile(null);
    setPreview(null);
  };

  async function confirm() {
    if (!file) return;
    setBusy(true);
    try {
      await onConfirm(file);
      clear();
    } catch {
      // The caller shows the error; keep the preview so they can retry.
    } finally {
      setBusy(false);
    }
  }

  const btn = compact ? 'btn btn--small btn--ghost' : 'btn btn--ghost';
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick('camera')} />
      <input ref={gallery} type="file" accept="image/*" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={pick('gallery')} />
    </>
  );

  if (file && preview) {
    return (
      <div class="media-preview stack" role="group" aria-label={t.previewLabel}>
        {inputs}
        <img src={preview} alt={t.previewAlt} />
        <div class="row">
          <button class={btn} type="button" disabled={busy} onClick={() => (source === 'camera' ? camera : gallery).current?.click()}>
            {source === 'camera' ? t.retake : t.chooseAnother}
          </button>
          <button class={btn} type="button" disabled={busy} onClick={clear}>{t.cancel}</button>
          <button class={compact ? 'btn btn--small' : 'btn'} type="button" disabled={busy} onClick={confirm} style="margin-left:auto">
            {busy ? t.uploading : t.confirm}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="row row--wrap">
      {inputs}
      {touch ? (
        <>
          <button class={btn} type="button" disabled={disabled} onClick={() => camera.current?.click()}>📷 {t.takePhoto}</button>
          <button class={btn} type="button" disabled={disabled} onClick={() => gallery.current?.click()}>🖼️ {t.chooseGallery}</button>
        </>
      ) : (
        <button class={btn} type="button" disabled={disabled} onClick={() => gallery.current?.click()}>📷 {addLabel ?? t.addPhoto}</button>
      )}
    </div>
  );
}
