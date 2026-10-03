import { describe, expect, it } from 'vitest';
import { parsePlanHtml, parseSetsReps, splitName, tabWeekdays } from '../shared/parse-plan';
import { checkPlanRules, PlanBody } from '../worker/planwrite';
import { parse } from '../worker/validate';
import html from './fixtures/plan-page.html?raw';
import { api, newPair } from './helpers';

describe('plan page parser', () => {
  it('splits only "(or …)" names; slash names stay whole', () => {
    expect(splitName('Push-ups (or Bench Press)')).toEqual({ name: 'Push-ups', altName: 'Bench Press' });
    expect(splitName('Pull-ups / Lat Pulldown')).toEqual({ name: 'Pull-ups / Lat Pulldown', altName: '' });
    expect(splitName('Diamond Push-ups (close grip)')).toEqual({ name: 'Diamond Push-ups (close grip)', altName: '' });
  });

  it('reads sets×reps and weekday tabs', () => {
    expect(parseSetsReps('4×8-10')).toEqual({ sets: 4, repsMin: 8, repsMax: 10, repsSuffix: '' });
    expect(parseSetsReps('3×12 each')).toEqual({ sets: 3, repsMin: 12, repsMax: null, repsSuffix: 'each' });
    expect(parseSetsReps('3x15-20')).toEqual({ sets: 3, repsMin: 15, repsMax: 20, repsSuffix: '' });
    expect(tabWeekdays('Mon / Thu')).toEqual([1, 4]);
    expect(tabWeekdays('Sunday')).toEqual([0]);
  });

  it('parses the page into days, shared days, rest day, exercises and diet', () => {
    const p = parsePlanHtml(html);
    expect(p.warnings).toEqual([]);
    expect(p).toMatchObject({ title: 'Test Plan & Co', tagline: 'Lift · eat · sleep', dietTitle: 'Test Diet', dietIntro: 'Keep it simple.' });
    expect(p.days).toEqual([
      { weekday: 1, title: 'Chest & Triceps', note: 'Repeats on Thursday.' },
      { weekday: 4, title: '', note: '', sameAs: 1 },
      { weekday: 3, title: 'Legs', note: 'Go deep.' },
      { weekday: 0, title: 'Sunday — Rest', note: "Don't skip it.", isRest: true, restMessage: 'Sleep 8 hours & drink water.' },
    ]);
    expect(p.exercises).toEqual([
      { weekday: 1, name: 'Push-ups', altName: 'Bench Press', muscles: 'Chest, front shoulders', notes: 'Elbows tucked', sets: 4, repsMin: 8, repsMax: 10, repsSuffix: '', icon: 'press' },
      { weekday: 1, name: 'Bench / Chair Dips', altName: '', muscles: 'Triceps', notes: 'Lower slowly', sets: 3, repsMin: 10, repsMax: null, repsSuffix: '', icon: 'press' },
      { weekday: 3, name: 'Lunges', altName: '', muscles: 'Quads', notes: 'Each leg', sets: 3, repsMin: 12, repsMax: null, repsSuffix: 'each', icon: 'lunge' },
    ]);
    expect(p.meals).toEqual([
      { timeLabel: 'Breakfast', name: '~1 hour later', itemList: [{ text: 'Bowl of oats', or: ['3-4 boiled eggs'] }, { text: 'A glass of milk', or: [] }] },
      { timeLabel: 'Mid-morning', name: 'Snack', itemList: [{ text: 'Paneer cubes', or: ['a fruit'] }] },
    ]);
    expect(p.stock).toEqual([{ emoji: '🍌', label: 'Bananas' }, { emoji: '🫘', label: 'Roasted chana' }, { emoji: '', label: 'Rice' }]);
    expect(p.dietTips).toBe('Keep it simple: eat every 3 hours.');
  });

  it('produces a body the API accepts, and saves through it', async () => {
    const { warnings, ...parsed } = parsePlanHtml(html);
    const body = { ...parsed, calorieGoal: 'surplus' as const };
    expect(() => checkPlanRules(parse(PlanBody, body))).not.toThrow();

    const { a, b } = await newPair();
    expect((await api('PUT', '/api/u/partner/plan', { cookie: a.cookie, body })).status).toBe(200);
    const got = await api('GET', '/api/u/me/plan', { cookie: b.cookie });
    expect(got.data.exercises).toHaveLength(3);
    expect(got.data.plan.stock).toHaveLength(3);
    expect(got.data.plan.updatedByName).toBe('Alex');
  });
});
