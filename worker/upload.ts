// Shared image upload checks and authenticated streaming, used by gym/chat
// photos and exercise photos. The browser does the real work (resize,
// re-encode, strip EXIF); this verifies it cheaply.
import { badRequest, HttpError, notFound } from './http';
import { hasMetadata, sniffMime, type ImageMime } from './image';
import type { Ctx } from './types';

export const MAX_PHOTO_BYTES = 1024 * 1024;

const tooLarge = () => new HttpError(413, 'too_large', 'Photos must be 1 MB or smaller after compression.');

export interface ImageUpload {
  bytes: Uint8Array;
  mime: ImageMime;
  form: FormData;
}

/** Parses a multipart upload with a `file` field and validates the image. */
export async function readImageUpload(c: Ctx): Promise<ImageUpload> {
  const declared = Number(c.req.headers.get('content-length') ?? 0);
  if (declared > MAX_PHOTO_BYTES + 16 * 1024) throw tooLarge();
  if (!(c.req.headers.get('content-type') ?? '').includes('multipart/form-data')) throw badRequest('Expected multipart/form-data.');

  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('file: is required', { field: 'file' });
  if (file.size > MAX_PHOTO_BYTES) throw tooLarge();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) throw new HttpError(415, 'unsupported', 'Only JPEG or WebP photos are accepted.');
  if (hasMetadata(bytes, mime)) throw badRequest('This photo still has location/camera metadata. Please re-upload from the app.');
  return { bytes, mime, form };
}

export const extFor = (mime: ImageMime) => (mime === 'image/webp' ? 'webp' : 'jpg');

/** Optional integer form field (width/height). */
export function intField(form: FormData, name: string): number | undefined {
  const raw = form.get(name);
  return raw ? Number(raw) : undefined;
}

/** Streams an R2 image with private caching. Callers authorize first. */
export async function streamImage(c: Ctx, id: string, r2Key: string, mime: string): Promise<Response> {
  const etag = `"${id}"`;
  const headers = {
    'content-type': mime,
    'cache-control': 'private, max-age=86400, immutable',
    etag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  };
  if (c.req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const obj = await c.env.PHOTOS.get(r2Key);
  if (!obj) throw notFound();
  return new Response(obj.body, { headers: { ...headers, 'content-length': String(obj.size) } });
}
