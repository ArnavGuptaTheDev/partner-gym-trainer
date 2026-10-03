// Client-side photo prep: honour EXIF orientation, resize to ≤1600px, then
// re-encode through a canvas, which drops all EXIF (incl. GPS). Tries WebP,
// falls back to JPEG, and steps quality/size down until it's under 1 MB.

export const MAX_EDGE = 1600;
export const MAX_BYTES = 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  type: 'image/webp' | 'image/jpeg';
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image.');
  const src = await decode(file);
  const srcW = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const srcH = 'naturalHeight' in src ? src.naturalHeight : src.height;

  let scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  for (let attempt = 0; attempt < 6; attempt++) {
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0, width, height);

    for (const quality of [0.8, 0.7, 0.6]) {
      let blob = await toBlob(canvas, 'image/webp', quality);
      let type: PreparedImage['type'] = 'image/webp';
      // Browsers without a WebP encoder silently return PNG.
      if (!blob || blob.type !== 'image/webp') {
        blob = await toBlob(canvas, 'image/jpeg', quality);
        type = 'image/jpeg';
      }
      if (blob && blob.size <= MAX_BYTES) {
        if ('close' in src) src.close();
        return { blob, width, height, type };
      }
    }
    scale *= 0.8;
  }
  throw new Error('Could not shrink this photo under 1 MB.');
}
