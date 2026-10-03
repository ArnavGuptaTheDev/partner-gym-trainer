import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { chat as t } from '../content/copy';
import { ApiError, get, post, type Me } from '../lib/api';
import { useVisiblePolling } from '../lib/hooks';
import { uploadPhoto } from '../lib/photos';
import MediaPicker from './MediaPicker';
import { ErrorNote, Loading, useMe } from './ui';

interface Message { id: number; senderId: string; body: string; photoUrl: string | null; createdAt: number }
interface Page { items: Message[]; hasMore: boolean; partnerLastReadId: number }

export const POLL_MS = 5000;

export default function ChatView() {
  const me = useMe();
  if (!me) return <Loading />;
  if (!me.pair) {
    return (
      <div class="card empty">
        <span class="big" aria-hidden="true">💬</span>
        <p>{t.unpaired}</p>
        <a class="btn" href="/settings">{t.pairCta}</a>
      </div>
    );
  }
  return <Conversation me={me} />;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayKey = (ms: number) => new Date(ms).toDateString();

function Conversation({ me }: { me: Me }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [partnerRead, setPartnerRead] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'' | 'send' | 'photo'>('');
  const [error, setError] = useState('');
  const [attaching, setAttaching] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  const partnerName = me.pair!.partner.displayName;

  const markRead = (id: number) => {
    if (!id || document.visibilityState !== 'visible') return;
    post('/api/messages/read', { lastId: id })
      .then(() => window.dispatchEvent(new CustomEvent('spotter:unread', { detail: 0 })))
      .catch(() => {});
  };

  const merge = (incoming: Message[]) =>
    setMessages((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      return [...cur, ...incoming.filter((m) => !seen.has(m.id))];
    });

  useEffect(() => {
    get<Page>('/api/messages').then((p) => {
      setMessages(p.items);
      setHasMore(p.hasMore);
      setPartnerRead(p.partnerLastReadId);
      setLoaded(true);
      markRead(p.items.at(-1)?.id ?? 0);
    }).catch((e) => setError(e.message));
  }, []);

  // Poll every 5 s while visible; paused automatically when the tab is hidden.
  useVisiblePolling(async () => {
    const p = await get<Page>(`/api/messages?after=${lastId}`);
    setPartnerRead(p.partnerLastReadId);
    if (p.items.length) {
      merge(p.items);
      markRead(p.items.at(-1)!.id);
    }
  }, POLL_MS, loaded);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = listRef.current!;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function loadOlder() {
    const first = messages[0]?.id;
    if (!first) return;
    const el = listRef.current!;
    const prevHeight = el.scrollHeight;
    const p = await get<Page>(`/api/messages?before=${first}`);
    stickToBottom.current = false;
    setMessages((cur) => [...p.items, ...cur]);
    setHasMore(p.hasMore);
    requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevHeight));
  }

  async function send(body: { body?: string; photoId?: string }) {
    setError('');
    try {
      const m = await post<Message>('/api/messages', body);
      stickToBottom.current = true;
      merge([m]);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      return false;
    }
  }

  async function submit(e?: Event) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy('send');
    if (await send({ body })) setText('');
    setBusy('');
  }

  async function attach(file: File) {
    setBusy('photo');
    setError('');
    try {
      const photo = await uploadPhoto(file, 'chat');
      await send({ photoId: photo.id, body: text.trim() || undefined });
      setText('');
      setAttaching(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e; // keeps the preview so they can retry
    } finally {
      setBusy('');
    }
  }

  const lastMine = [...messages].reverse().find((m) => m.senderId === me.user.id);

  return (
    <div class="chat">
      <div class="chat-log" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label={`Chat with ${partnerName}`}>
        {hasMore && <button class="btn btn--small btn--ghost" type="button" style="align-self:center" onClick={loadOlder}>{t.loadOlder}</button>}
        {loaded && messages.length === 0 && <p class="empty">{t.empty(partnerName)}</p>}
        {messages.map((m, i) => {
          const mine = m.senderId === me.user.id;
          const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
          const onlyEmoji = !m.photoUrl && /^\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\s]{0,6}$/u.test(m.body);
          return (
            <Fragment key={m.id}>
              {newDay && <p class="chat-day">{new Date(m.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</p>}
              <div class={`bubble ${mine ? 'bubble--mine' : ''} ${onlyEmoji ? 'bubble--emoji' : ''}`}>
                <span class="sr-only">{mine ? t.you : partnerName}: </span>
                {m.photoUrl && <img src={m.photoUrl} alt={t.photoAlt(mine ? t.you : partnerName)} loading="lazy" />}
                {m.body && <span class="bubble-text">{m.body}</span>}
                <span class="bubble-time">
                  {time(m.createdAt)}
                  {mine && m.id === lastMine?.id && partnerRead >= m.id && ` · ${t.seen}`}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div class="chips" role="group" aria-label={t.emojiLabel}>
        {t.emoji.map((e) => (
          <button key={e} type="button" class="chip" aria-label={`Send ${e}`} onClick={() => send({ body: e })}>{e}</button>
        ))}
      </div>
      {attaching && (
        <div class="card card--soft" style="padding:10px">
          <MediaPicker compact addLabel={t.attach} confirmLabel={t.sendPhoto} disabled={!!busy} onConfirm={attach} />
        </div>
      )}
      <form class="chat-composer" onSubmit={submit}>
        <button class="icon-btn" type="button" aria-expanded={attaching} aria-label={attaching ? t.closeAttach : t.attach} title={t.attach} onClick={() => setAttaching(!attaching)}>
          <span aria-hidden="true">{busy === 'photo' ? '⏳' : attaching ? '✕' : '📷'}</span>
        </button>
        <label for="chat-input" class="sr-only">{t.messageLabel}</label>
        <textarea
          id="chat-input"
          rows={1}
          value={text}
          maxLength={2000}
          placeholder={t.placeholder}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <button class="btn" type="submit" disabled={!text.trim() || !!busy}>{t.send}</button>
      </form>
    </div>
  );
}
