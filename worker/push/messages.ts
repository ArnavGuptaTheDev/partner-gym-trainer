// Notification texts. These show on lock screens, so they never include
// weight, body or calorie numbers. The title is always the partner's name.
import type { PushMessage } from './send';

const PREVIEW_MAX = 100;

export function previewText(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

export const pushText = {
  message: (from: string, body: string, hasPhoto: boolean, hidePreviews: boolean): PushMessage => ({
    title: from,
    body: hidePreviews ? 'sent you a message' : body.trim() ? previewText(body) : hasPhoto ? 'sent a photo 📷' : 'sent you a message',
    url: '/chat',
    tag: 'message',
    renotify: true,
  }),
  nudge: (from: string, kind: 'proud' | 'gym'): PushMessage => ({
    title: from,
    body: kind === 'proud' ? 'is proud of you 💖' : 'says get to the gym 🏋️',
    url: '/',
    tag: 'nudge',
    renotify: true,
  }),
  photo: (from: string): PushMessage => ({ title: from, body: 'posted a gym photo 📸', url: '/photos?who=partner', tag: 'photo' }),
  plan: (from: string, forSelf: boolean): PushMessage =>
    forSelf
      ? { title: from, body: 'updated their plan ✍️', url: '/plan?who=partner', tag: 'plan' }
      : { title: from, body: 'updated your plan ✍️', url: '/plan', tag: 'plan' },
  note: (from: string): PushMessage => ({ title: from, body: 'left you a note of the day 💌', url: '/', tag: 'note' }),
  milestone: (from: string, kind: string): PushMessage => ({ title: from, body: `hit a milestone: ${MILESTONE_LABELS[kind] ?? 'a new milestone'} 🏆`, url: '/', tag: 'milestone' }),
  workout: (from: string): PushMessage => ({ title: from, body: 'finished their workout 💪', url: '/log?who=partner', tag: 'workout' }),
};

/** Weight milestones are named without numbers; streaks are day counts. */
const MILESTONE_LABELS: Record<string, string> = {
  first_kg: 'a weight milestone',
  halfway: 'halfway to their goal',
  target: 'their goal weight',
  streak_7: 'a 7-day streak',
  streak_30: 'a 30-day streak',
  streak_100: 'a 100-day streak',
};
