// Browser side of Web Push: permission state, (re)subscribing, unsubscribing.
import { get, post, put } from './api';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'default' | 'granted';

export interface PushConfig {
  publicKey: string | null;
  enabled: boolean;
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Running as an installed home-screen app. */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushState(): PushState {
  // iOS only supports Web Push for apps added to the Home Screen.
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
};

async function registration() {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** This browser's subscription, created (or recreated after a key change) if needed. */
async function ensureSubscription(publicKey: string): Promise<PushSubscription> {
  const reg = await registration();
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export const pushConfig = () => get<PushConfig>('/api/push/config');

/** Whether this browser currently has a push subscription. */
export async function hasSubscription(): Promise<boolean> {
  if (pushState() !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return !!(await reg?.pushManager.getSubscription());
}

/**
 * From a button tap only: asks permission, subscribes this device and turns
 * notifications on.
 */
export async function enablePush(): Promise<'ok' | 'denied' | 'dismissed' | 'unavailable'> {
  const cfg = await pushConfig();
  if (!cfg.publicKey) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';
  const sub = await ensureSubscription(cfg.publicKey);
  await post('/api/push/subscribe', sub.toJSON());
  await put('/api/push/prefs', { enabled: true });
  return 'ok';
}

/**
 * On every app load: if allowed and enabled, (re)register this device. This
 * rebinds it to the current session and recovers from rotated endpoints.
 */
export async function resubscribeOnLoad(): Promise<void> {
  if (pushState() !== 'granted') return;
  const cfg = await pushConfig();
  if (!cfg.publicKey || !cfg.enabled) return;
  const sub = await ensureSubscription(cfg.publicKey);
  await post('/api/push/subscribe', sub.toJSON());
}

/** Stops push on this browser (logout, account deletion, "off on this device"). */
export async function unsubscribeThisDevice(tellServer = true): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (tellServer) await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } catch {
    /* best effort; the server also drops it when the session ends */
  }
}
