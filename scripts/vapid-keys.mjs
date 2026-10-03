// Generates a VAPID key pair for Web Push (P-256, WebCrypto).
//
//   npm run vapid:keys
//
// Then set them as Worker secrets (see README "Push notifications"):
//   VAPID_PUBLIC_KEY   (not secret; the browser needs it too)
//   VAPID_PRIVATE_KEY  (secret)
//   VAPID_SUBJECT      (mailto:you@example.com)
//
// Generate once. Changing the keys invalidates every existing subscription
// (devices re-subscribe automatically on their next app load).
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = b64url(await crypto.subtle.exportKey('raw', publicKey)); // 65-byte uncompressed point
const { d } = await crypto.subtle.exportKey('jwk', privateKey);

console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log('\nAdd both to .dev.vars for local use, plus VAPID_SUBJECT=mailto:you@example.com.');
console.log('For production: npx wrangler secret put VAPID_PUBLIC_KEY (and VAPID_PRIVATE_KEY, VAPID_SUBJECT).');
