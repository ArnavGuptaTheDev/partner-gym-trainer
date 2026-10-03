// Day header and rest-day box, shared by the Plan and Log screens.
import { plan as t } from '../content/copy';
import type { PlanDay } from '../lib/plan';
import { dayLong } from '../lib/units';

export function DayHead({ weekday, day, source }: { weekday: number; day?: PlanDay; source?: PlanDay }) {
  const title = day?.title || source?.title || '';
  const note = day?.note || source?.note || '';
  return (
    <div class="day-head">
      <h2>{title ? `${dayLong(weekday)} · ${title}` : dayLong(weekday)}</h2>
      {note && <p>{note}</p>}
      {day?.sameAs != null && <span class="pill">{t.sameAsPill(dayLong(day.sameAs))}</span>}
    </div>
  );
}

export function RestBox({ message }: { message: string }) {
  return (
    <div class="rest-box">
      <div class="big" aria-hidden="true">🛌</div>
      <h3>{t.restTitle}</h3>
      <p>{message || t.restDefault}</p>
    </div>
  );
}
