// Dependency-free SVG line chart for the weight log.
import { toDisplayWeight, weightUnit, type Units } from '../lib/units';

export interface Point { date: string; weightKg: number }

export default function WeightChart({ points, targetKg, units, label }: { points: Point[]; targetKg: number | null; units: Units; label: string }) {
  if (points.length < 2) return null;
  const data = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 10, t: 12, b: 22 };
  const vals = data.map((p) => toDisplayWeight(p.weightKg, units)!);
  const target = toDisplayWeight(targetKg, units);
  const all = target != null ? [...vals, target] : vals;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < 2) { min -= 1; max += 1; }
  const t0 = Date.parse(data[0].date);
  const t1 = Date.parse(data[data.length - 1].date);
  const x = (d: string) => pad.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const path = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
  const area = `${path} L${x(data[data.length - 1].date).toFixed(1)},${H - pad.b} L${pad.l},${H - pad.b} Z`;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const first = vals[0];
  const last = vals[vals.length - 1];

  return (
    <figure style="margin:0">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${label}: from ${first} to ${last} ${weightUnit(units)}`} style="display:block;overflow:visible">
        <defs>
          <linearGradient id="wfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity="0.25" />
            <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" stroke-width="1" />
            <text x={pad.l - 6} y={y(v) + 4} text-anchor="end" font-size="10" fill="var(--text-soft)">{Math.round(v)}</text>
          </g>
        ))}
        {target != null && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} stroke="var(--mint)" stroke-width="1.5" stroke-dasharray="4 4" />
            <text x={W - pad.r} y={y(target) - 4} text-anchor="end" font-size="10" fill="var(--mint)">target</text>
          </g>
        )}
        <path d={area} fill="url(#wfill)" />
        <path d={path} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        {data.map((p, i) => (
          <circle key={p.date} cx={x(p.date)} cy={y(vals[i])} r={i === data.length - 1 ? 4.5 : 2.5} fill={i === data.length - 1 ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" stroke-width="1.5" />
        ))}
        <text x={pad.l} y={H - 4} font-size="10" fill="var(--text-soft)">{fmt(data[0].date)}</text>
        <text x={W - pad.r} y={H - 4} text-anchor="end" font-size="10" fill="var(--text-soft)">{fmt(data[data.length - 1].date)}</text>
      </svg>
    </figure>
  );
}
