// Test-side Web Push "browser": creates real P-256 subscription keys and
// decrypts what the server sends (RFC 8291 receiver side).
import { b64url, fromB64url } from '../worker/crypto';
import { concat, deriveKeys } from '../worker/push/encrypt';
import { api, FAKE_PUSH_ORIGIN, pushRequests, type TestUser } from './helpers';

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface FakeDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
  authSecret: Uint8Array;
}

let seq = 0;
export async function newDevice(): Promise<FakeDevice> {
  const pair = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: `${FAKE_PUSH_ORIGIN}/fcm/send/device-${Date.now()}-${++seq}`,
    keys: { p256dh: b64url(publicRaw), auth: b64url(authSecret) },
    privateKey: pair.privateKey,
    publicRaw,
    authSecret,
  };
}

/** Subscribes `device` for `user` (as the app does on enable and on load). */
export async function subscribe(user: TestUser, device: FakeDevice) {
  return api('POST', '/api/push/subscribe', { cookie: user.cookie, body: { endpoint: device.endpoint, keys: device.keys } });
}

/** Turns notifications on (subscribe + master toggle), as the Enable button does. */
export async function enablePush(user: TestUser, device?: FakeDevice) {
  const d = device ?? (await newDevice());
  const res = await subscribe(user, d);
  if (res.status !== 200) throw new Error(`subscribe failed: ${res.status} ${JSON.stringify(res.data)}`);
  await api('PUT', '/api/push/prefs', { cookie: user.cookie, body: { enabled: true } });
  return d;
}

/** Decrypts an aes128gcm push body for `device`. */
export async function decrypt(device: FakeDevice, body: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, P256, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, device.privateKey, 256),
  );
  const { cek, nonce } = await deriveKeys(ecdh, device.authSecret, device.publicRaw, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  // Strip the 0x02 delimiter (and any zero padding after it).
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 0x02) throw new Error('bad padding delimiter');
  return new TextDecoder().decode(padded.slice(0, end));
}

/** Notifications delivered to `device` since `from` (index into pushRequests), decrypted. */
export async function received(device: FakeDevice, from = 0): Promise<{ title: string; body: string; url: string; tag: string }[]> {
  const mine = pushRequests.slice(from).filter((r) => r.endpoint === device.endpoint);
  return Promise.all(mine.map(async (r) => JSON.parse(await decrypt(device, r.body))));
}

export { concat, fromB64url };
