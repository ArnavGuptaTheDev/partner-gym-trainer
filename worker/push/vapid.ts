// VAPID (RFC 8292): an ES256-signed JWT that identifies this server to the
// push service. WebCrypto's ECDSA signature is already the raw r||s form JWS
// expects.
import { b64url, fromB64url } from '../crypto';
import type { Env } from '../types';

const JWT_TTL_SEC = 12 * 3600;
const cache = new Map<string, { header: string; exp: number }>();

export function vapidConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

async function signingKey(env: Env): Promise<CryptoKey> {
  const pub = fromB64url(env.VAPID_PUBLIC_KEY!);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 point');
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY!, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

const encJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** `Authorization` header value for a push endpoint, cached per push service. */
export async function vapidAuthorization(env: Env, endpoint: string, now: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cacheKey = `${env.VAPID_PUBLIC_KEY}|${aud}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.exp - 600 > now / 1000) return hit.header;

  const exp = Math.floor(now / 1000) + JWT_TTL_SEC;
  const unsigned = `${encJson({ typ: 'JWT', alg: 'ES256' })}.${encJson({ aud, exp, sub: env.VAPID_SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), new TextEncoder().encode(unsigned));
  const header = `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
  cache.set(cacheKey, { header, exp });
  return header;
}
