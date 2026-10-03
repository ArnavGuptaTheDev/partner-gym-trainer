import { api, today } from './api';
import { prepareImage } from './image';

export interface Photo {
  id: string;
  userId: string;
  date: string;
  url: string;
  width: number | null;
  height: number | null;
  caption: string;
  createdAt: number;
}

/** Compresses then uploads one photo. Used by the timeline and chat. */
export async function uploadPhoto(file: File, kind: 'gym' | 'chat', caption = ''): Promise<Photo> {
  const img = await prepareImage(file);
  const form = new FormData();
  form.set('file', new File([img.blob], img.type === 'image/webp' ? 'photo.webp' : 'photo.jpg', { type: img.type }));
  form.set('kind', kind);
  form.set('date', today());
  form.set('width', String(img.width));
  form.set('height', String(img.height));
  if (caption) form.set('caption', caption);
  return api<Photo>('POST', '/api/u/me/photos', form);
}
