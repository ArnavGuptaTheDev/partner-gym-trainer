import { useEffect, useState } from 'preact/hooks';
import { admin } from '../content/copy';
import { ApiError, del, get, getMe, post } from '../lib/api';
import { usePaged } from '../lib/hooks';

interface Invite {
  id: string;
  note: string;
  createdAt: number;
  expiresAt: number;
  status: 'active' | 'used' | 'revoked' | 'expired';
  usedBy: { displayName: string; email: string } | null;
}
interface Account {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: number;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function AdminPanel() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    getMe().then((m) => setAllowed(m.user.isSuper)).catch(() => setAllowed(false));
  }, []);
  if (allowed === null) return <p class="muted">Loading…</p>;
  if (!allowed) return <p class="alert alert--error">Super users only.</p>;
  return (
    <div class="stack">
      <Invites />
      <Accounts />
      <Storage />
    </div>
  );
}

function Invites() {
  const list = usePaged<Invite>('/api/admin/invites');
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function create(e: Event) {
    e.preventDefault();
    setError('');
    try {
      const res = await post<{ url: string }>('/api/admin/invites', { note: note || undefined });
      setFresh(res.url);
      setCopied(false);
      setNote('');
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function revoke(id: string) {
    if (!confirm(admin.revokeConfirm)) return;
    try {
      await del(`/api/admin/invites/${id}`);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function copy() {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh);
    setCopied(true);
  }

  return (
    <section class="card stack" aria-labelledby="inv-h">
      <h2 id="inv-h">{admin.invitesTitle}</h2>
      <form class="row" onSubmit={create}>
        <label class="sr-only" for="inv-note">{admin.noteLabel}</label>
        <input id="inv-note" value={note} maxLength={100} placeholder={admin.notePlaceholder} onInput={(e) => setNote(e.currentTarget.value)} />
        <button class="btn" type="submit">{admin.newInvite}</button>
      </form>
      {fresh && (
        <div class="card card--sun stack" role="status">
          <p class="small" style="margin:0">{admin.copyOnce}</p>
          <code style="word-break:break-all;font-size:0.85rem">{fresh}</code>
          <button class="btn btn--small" type="button" onClick={copy}>{copied ? admin.copied : admin.copy}</button>
        </div>
      )}
      {error && <p class="alert alert--error" role="alert">{error}</p>}
      {list.items.length === 0 && !list.loading && <p class="muted">{admin.empty}</p>}
      <ul class="stack" style="list-style:none;padding:0;margin:0">
        {list.items.map((i) => (
          <li class="card card--soft spread" key={i.id}>
            <div>
              <div class="row row--wrap">
                <strong>{i.note || 'Invite'}</strong>
                <span class={`pill ${i.status === 'active' ? 'pill--ok' : ''}`}>{admin.status[i.status]}</span>
              </div>
              <div class="small muted">
                {i.usedBy
                  ? `${admin.usedBy} ${i.usedBy.displayName} (${i.usedBy.email})`
                  : `${admin.expires} ${fmtDate(i.expiresAt)}`}
              </div>
            </div>
            {i.status === 'active' && (
              <button class="btn btn--small btn--danger" type="button" onClick={() => revoke(i.id)}>
                {admin.revoke}
              </button>
            )}
          </li>
        ))}
      </ul>
      {list.hasMore && (
        <button class="btn btn--ghost btn--small" type="button" onClick={list.loadMore} disabled={list.loading}>
          {admin.loadMore}
        </button>
      )}
    </section>
  );
}

function Accounts() {
  const list = usePaged<Account>('/api/admin/users');
  const [error, setError] = useState('');

  async function toggle(u: Account) {
    if (u.isActive && !confirm(admin.deactivateConfirm)) return;
    try {
      await post(`/api/admin/users/${u.id}/${u.isActive ? 'deactivate' : 'reactivate'}`);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section class="card stack" aria-labelledby="acc-h">
      <h2 id="acc-h">{admin.usersTitle}</h2>
      {error && <p class="alert alert--error" role="alert">{error}</p>}
      <ul class="stack" style="list-style:none;padding:0;margin:0">
        {list.items.map((u) => (
          <li class="card card--soft spread" key={u.id}>
            <div>
              <strong>{u.displayName}</strong>
              <div class="small muted" style="word-break:break-all">{u.email}</div>
            </div>
            <button class={`btn btn--small ${u.isActive ? 'btn--danger' : 'btn--ghost'}`} type="button" onClick={() => toggle(u)}>
              {u.isActive ? admin.deactivate : admin.reactivate}
            </button>
          </li>
        ))}
      </ul>
      {list.hasMore && (
        <button class="btn btn--ghost btn--small" type="button" onClick={list.loadMore} disabled={list.loading}>
          {admin.loadMore}
        </button>
      )}
    </section>
  );
}

function Storage() {
  const [data, setData] = useState<{ totalBytes: number; photoCount: number; users: { displayName: string; bytes: number; count: number }[] } | null>(null);
  useEffect(() => {
    get('/api/admin/storage').then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  const pct = Math.min(100, (data.totalBytes / (10 * 1024 ** 3)) * 100);
  return (
    <section class="card stack" aria-labelledby="st-h">
      <h2 id="st-h">{admin.storageTitle}</h2>
      <p style="margin:0">
        <strong class="display" style="font-size:1.6rem">{mb(data.totalBytes)}</strong>{' '}
        <span class="muted">in {data.photoCount} photos, of the 10 GB R2 free tier</span>
      </p>
      <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Storage used">
        <span style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <ul class="small" style="padding-left:18px;margin:0">
        {data.users.map((u) => (
          <li key={u.displayName}>{u.displayName}: {mb(u.bytes)} ({u.count})</li>
        ))}
      </ul>
    </section>
  );
}
