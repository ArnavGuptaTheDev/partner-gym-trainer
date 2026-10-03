// Cheap server-side checks on uploaded images. The client does the real
// work (resize, re-encode, strip EXIF); this verifies it, using only a scan
// of container headers so CPU stays tiny.

export type ImageMime = 'image/jpeg' | 'image/webp';

export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** True if the file still carries EXIF/XMP metadata (e.g. GPS location). */
export function hasMetadata(b: Uint8Array, mime: ImageMime): boolean {
  return mime === 'image/jpeg' ? jpegHasMetadata(b) : webpHasMetadata(b);
}

function jpegHasMetadata(b: Uint8Array): boolean {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return false; // not a marker: stop scanning
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) return false; // start of scan / end
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1) {
      const tag = ascii(b, i + 4, 4);
      if (tag === 'Exif' || tag === 'http') return true; // EXIF or XMP
    }
    i += 2 + len;
  }
  return false;
}

function webpHasMetadata(b: Uint8Array): boolean {
  let i = 12;
  while (i + 8 <= b.length) {
    const id = ascii(b, i, 4);
    if (id === 'EXIF' || id === 'XMP ') return true;
    const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    i += 8 + size + (size & 1);
  }
  return false;
}
