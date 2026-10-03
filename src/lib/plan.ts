// Client-side plan types and helpers (rules shared with the Worker live in
// shared/plan.ts).
import { formatReps, formatSetsReps, type ExerciseIcon } from '../../shared/plan';
import { api } from './api';
import { prepareImage } from './image';

export interface PlanMedia {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PlanExercise {
  id?: string;
  weekday: number;
  name: string;
  altName: string;
  muscles: string;
  notes: string;
  equipment: string;
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  repsSuffix: string;
  /** Formatted (or legacy free-text) reps from the server. */
  reps: string;
  targetWeightKg: number | null;
  icon: ExerciseIcon | null;
  links: string[];
  media: PlanMedia[];
}

export interface PlanDay {
  weekday: number;
  title: string;
  note: string;
  isRest: boolean;
  restMessage: string;
  sameAs: number | null;
}

/** "4×8-10", "3×12 each", or legacy text like "3×45s". */
export function setsRepsLabel(e: Pick<PlanExercise, 'sets' | 'repsMin' | 'repsMax' | 'repsSuffix' | 'reps'>): string {
  const reps = e.repsMin != null ? formatReps(e.repsMin, e.repsMax, e.repsSuffix) : e.reps;
  return formatSetsReps(e.sets, reps);
}

/** Best-effort split of legacy free-text reps ("8-12", "12 each") into fields. */
export function parseLegacyReps(text: string): { repsMin: number | null; repsMax: number | null; repsSuffix: string } | null {
  const m = text.trim().match(/^(\d+)(?:\s*-\s*(\d+))?\s*(.*)$/);
  if (!m) return null;
  return { repsMin: Number(m[1]), repsMax: m[2] ? Number(m[2]) : null, repsSuffix: m[3].trim() };
}

/** Compress (same pipeline as gym photos) and upload an exercise photo. */
export async function uploadPlanMedia(file: File, who: 'me' | 'partner'): Promise<PlanMedia> {
  const img = await prepareImage(file);
  const form = new FormData();
  form.set('file', new File([img.blob], img.type === 'image/webp' ? 'photo.webp' : 'photo.jpg', { type: img.type }));
  form.set('width', String(img.width));
  form.set('height', String(img.height));
  return api<PlanMedia>('POST', `/api/u/${who}/plan/media`, form);
}
