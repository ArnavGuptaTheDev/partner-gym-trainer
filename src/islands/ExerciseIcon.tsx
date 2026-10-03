// Line-art exercise pictograms (after the hand-made plan page these came
// from). Colours follow the theme: strokes use --accent, heads --skin and
// weights --text.
import type { ExerciseIcon as IconName } from '../../shared/plan';

const S = { strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const head = (cx: number, cy: number) => <circle cx={cx} cy={cy} r={8} fill="var(--skin)" stroke="none" />;
const plate = (cx: number, cy: number, r = 6) => <circle cx={cx} cy={cy} r={r} fill="var(--text)" stroke="none" />;
const bar = (x: number, y: number, w = 12, h = 7) => <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--text)" stroke="none" />;
const p = (d: string) => <path d={d} {...S} />;

const ICONS: Record<IconName, preact.JSX.Element> = {
  press: <>{bar(10, 36, 12, 18)}{bar(78, 36, 12, 18)}{p('M16 40 L84 40')}{p('M30 40 L30 20')}{head(30, 22)}{p('M30 29 L30 55')}{p('M30 55 L18 78 M30 55 L42 78')}</>,
  dip: <>{p('M38 30 L38 60 M62 30 L62 60')}{head(50, 18)}{p('M50 25 L50 55')}{p('M50 40 L38 40 M50 40 L62 40')}{p('M50 55 L40 80 M50 55 L60 80')}</>,
  curl: <>{head(35, 18)}{p('M35 25 L35 55')}{p('M35 55 L25 80 M35 55 L45 80')}{p('M35 33 L58 33 L52 15')}{plate(52, 12)}{p('M35 33 L18 45')}</>,
  pull: <>{p('M18 15 L82 15')}{head(50, 26)}{p('M50 33 L50 62')}{p('M50 20 L34 16 M50 20 L66 16')}{p('M50 62 L38 84 M50 62 L62 84')}</>,
  row: <>{head(30, 20)}{p('M30 27 L55 55')}{p('M55 55 L80 60 M55 55 L78 40')}{plate(80, 60)}{p('M55 55 L52 80 M55 55 L68 78')}</>,
  squat: <>{head(50, 16)}{bar(15, 27)}{bar(73, 27)}{p('M50 23 L50 48')}{p('M27 30 L73 30')}{p('M50 48 L30 60 L30 82')}{p('M50 48 L70 60 L70 82')}</>,
  lunge: <>{head(42, 14)}{p('M42 21 L46 45')}{p('M46 45 L25 55 L18 80')}{p('M46 45 L68 50 L80 35')}{p('M42 26 L28 34 M42 26 L58 20')}</>,
  bridge: <>{head(20, 60)}{p('M27 58 L50 45 L75 58')}{p('M75 58 L75 80')}{p('M50 45 L48 68')}</>,
  overhead: <>{bar(22, 6)}{bar(66, 6)}{head(50, 16)}{p('M50 23 L50 55')}{p('M50 30 L30 12 M50 30 L70 12')}{p('M50 55 L38 80 M50 55 L62 80')}</>,
  lateral: <>{head(50, 18)}{p('M50 25 L50 55')}{p('M50 32 L20 26 M50 32 L80 26')}{plate(18, 26, 5)}{plate(82, 26, 5)}{p('M50 55 L38 80 M50 55 L62 80')}</>,
  calf: <>{head(50, 16)}{p('M50 23 L50 55')}{p('M50 30 L34 40 M50 30 L66 40')}{p('M50 55 L44 76 L38 78 M50 55 L58 76 L64 78')}</>,
  hinge: <>{head(18, 55)}{p('M25 53 L55 45 L82 55')}{p('M55 45 L55 20')}</>,
  kickback: <>{head(30, 20)}{p('M30 27 L55 50')}{p('M55 50 L80 45')}{plate(80, 45, 5)}{p('M55 50 L50 78 M55 50 L68 76')}</>,
};

export const ICON_LABELS: Record<IconName, string> = {
  press: 'Press', dip: 'Dip', curl: 'Curl', pull: 'Pull-up', row: 'Row', squat: 'Squat', lunge: 'Lunge',
  bridge: 'Bridge', overhead: 'Overhead', lateral: 'Lateral raise', calf: 'Calf raise', hinge: 'Hinge', kickback: 'Kickback',
};

export default function ExerciseIcon({ name, size = 56 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" stroke="var(--accent)" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}
