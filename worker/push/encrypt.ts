// Web Push message encryption (RFC 8291) using the aes128gcm content coding
// (RFC 8188). WebCrypto only, so it runs on Workers.

const enc = new TextEncoder();
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
export const RECORD_SIZE = 4096;

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export interface EncryptOptions {
  /** Fixed salt and sender key pair, for the RFC test vector only. */
  salt?: Uint8Array;
  senderKeys?: { privateKey: CryptoKey; publicRaw: Uint8Array };
}

/** Intermediate values, exposed for testing against RFC 8291 Appendix A. */
export async function deriveKeys(ecdhSecret: Uint8Array, authSecret: Uint8Array, uaPublic: Uint8Array, asPublic: Uint8Array, salt: Uint8Array) {
  // RFC 8291 §3.4: combine the ECDH secret with the auth secret.
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 §2.2/2.3: content encryption key and nonce.
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  return { ikm, cek, nonce };
}

/**
 * Encrypts `plaintext` for a subscription's `p256dh` public key and `auth`
 * secret. Returns the complete aes128gcm body: salt | rs | idlen | keyid |
 * ciphertext, as a single record.
 */
export async function encryptPayload(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, opts: EncryptOptions = {}): Promise<Uint8Array> {
  if (plaintext.length > RECORD_SIZE - 17) throw new Error('Push payload too large');
  // Importing validates that the browser's key is a point on P-256 (RFC 8291 §7).
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, P256, false, []);

  let sender = opts.senderKeys;
  if (!sender) {
    const pair = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
    sender = { privateKey: pair.privateKey, publicRaw: new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  // workers-types spells the member `$public`; the runtime takes the
  // standard WebCrypto `public` (verified by the RFC 8291 vector test).
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, sender.privateKey, 256));
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, sender.publicRaw, salt);

  // One record: plaintext followed by the last-record padding delimiter.
  const record = concat(plaintext, new Uint8Array([0x02]));
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const header = new Uint8Array(16 + 4 + 1 + sender.publicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = sender.publicRaw.length;
  header.set(sender.publicRaw, 21);
  return concat(header, ciphertext);
}
