// Diet section of the plan editor: header, meals (time label, heading,
// items with "OR" alternatives), keep-stocked chips and tips.
import { plan as t } from '../content/copy';
import type { Meal, MealItem, StockItem } from './PlanView';

export interface EditMeal {
  key: string;
  id?: string;
  timeLabel: string;
  name: string;
  items: MealItem[];
  notes: string;
}
export interface DietState {
  title: string;
  intro: string;
  tips: string;
  stock: StockItem[];
  meals: EditMeal[];
}

let seq = 0;
const key = () => `m${++seq}`;

export function initialDiet(meals: Meal[], plan: { dietTitle?: string; dietIntro?: string; dietTips?: string; stock?: StockItem[] } | null): DietState {
  return {
    title: plan?.dietTitle ?? '',
    intro: plan?.dietIntro ?? '',
    tips: plan?.dietTips ?? '',
    stock: plan?.stock ?? [],
    meals: meals.length
      ? meals.map((m) => ({ key: key(), id: m.id, timeLabel: m.timeLabel, name: m.name, items: m.itemList.length ? m.itemList : [{ text: '', or: [] }], notes: m.notes }))
      : [{ key: key(), timeLabel: 'Breakfast', name: '', items: [{ text: '', or: [] }], notes: '' }],
  };
}

/** API body fields for the diet. Blank items/alternatives are dropped. */
export function dietBody(d: DietState) {
  return {
    dietTitle: d.title.trim(),
    dietIntro: d.intro.trim(),
    dietTips: d.tips.trim(),
    stock: d.stock.filter((s) => s.label.trim()).map((s) => ({ emoji: s.emoji.trim(), label: s.label.trim() })),
    meals: d.meals
      .filter((m) => m.name.trim())
      .map((m) => ({
        id: m.id,
        timeLabel: m.timeLabel.trim(),
        name: m.name.trim(),
        itemList: m.items
          .filter((it) => it.text.trim())
          .map((it) => ({ text: it.text.trim(), or: it.or.map((o) => o.trim()).filter(Boolean) })),
        notes: m.notes.trim(),
      })),
  };
}

export default function DietEditor({ diet, set }: { diet: DietState; set: (d: DietState) => void }) {
  const setMeal = (k: string, patch: Partial<EditMeal>) => set({ ...diet, meals: diet.meals.map((m) => (m.key === k ? { ...m, ...patch } : m)) });
  const moveMeal = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= diet.meals.length) return;
    const next = [...diet.meals];
    [next[i], next[j]] = [next[j], next[i]];
    set({ ...diet, meals: next });
  };

  return (
    <section class="card stack" aria-labelledby="ed-diet">
      <h2 id="ed-diet">{t.dietTitleSection}</h2>
      <Text id="diet-title" label={t.dietName} value={diet.title} max={60} placeholder={t.dietNamePlaceholder} set={(v) => set({ ...diet, title: v })} />
      <Text id="diet-intro" label={t.dietIntro} value={diet.intro} max={300} placeholder={t.dietIntroPlaceholder} set={(v) => set({ ...diet, intro: v })} />

      <h3>{t.mealsTitle}</h3>
      {diet.meals.map((m, i) => (
        <fieldset class="editor-item stack" key={m.key}>
          <legend class="sr-only">{`${t.mealName} ${i + 1}`}</legend>
          <div class="grid-2">
            <Text id={`${m.key}-time`} label={t.mealTime} value={m.timeLabel} max={30} placeholder={t.mealTimePlaceholder} set={(v) => setMeal(m.key, { timeLabel: v })} />
            <Text id={`${m.key}-name`} label={t.mealHeading} value={m.name} max={60} placeholder={t.mealHeadingPlaceholder} set={(v) => setMeal(m.key, { name: v })} />
          </div>

          <div class="stack" role="group" aria-label={t.mealItems}>
            <span class="label">{t.mealItems}</span>
            {m.items.map((it, ii) => (
              <div class="meal-item-edit stack" key={ii}>
                <div class="row">
                  <label class="sr-only" for={`${m.key}-i${ii}`}>{`${t.item} ${ii + 1}`}</label>
                  <input id={`${m.key}-i${ii}`} value={it.text} maxLength={200} placeholder={t.itemPlaceholder} onInput={(e) => { const v = e.currentTarget.value; setMeal(m.key, { items: m.items.map((x, j) => (j === ii ? { ...x, text: v } : x)) }); }} />
                  <button class="icon-btn" type="button" aria-label={`${t.remove} ${t.item} ${ii + 1}`} onClick={() => setMeal(m.key, { items: m.items.filter((_, j) => j !== ii) })}>×</button>
                </div>
                {it.or.map((o, oi) => (
                  <div class="row meal-or-edit" key={oi}>
                    <span class="or-label" aria-hidden="true">{t.orLabel}</span>
                    <label class="sr-only" for={`${m.key}-i${ii}-o${oi}`}>{t.alternativeTo(it.text || `${t.item} ${ii + 1}`)}</label>
                    <input id={`${m.key}-i${ii}-o${oi}`} value={o} maxLength={200} placeholder={t.altPlaceholder} onInput={(e) => { const v = e.currentTarget.value; setMeal(m.key, { items: m.items.map((x, j) => (j === ii ? { ...x, or: x.or.map((y, k) => (k === oi ? v : y)) } : x)) }); }} />
                    <button class="icon-btn" type="button" aria-label={t.removeAlternative} onClick={() => setMeal(m.key, { items: m.items.map((x, j) => (j === ii ? { ...x, or: x.or.filter((_, k) => k !== oi) } : x)) })}>×</button>
                  </div>
                ))}
                {it.or.length < 4 && (
                  <button class="btn btn--small btn--ghost" type="button" style="align-self:flex-start" onClick={() => setMeal(m.key, { items: m.items.map((x, j) => (j === ii ? { ...x, or: [...x.or, ''] } : x)) })}>
                    + {t.addAlternative}
                  </button>
                )}
              </div>
            ))}
            {m.items.length < 20 && (
              <button class="btn btn--small btn--ghost" type="button" style="align-self:flex-start" onClick={() => setMeal(m.key, { items: [...m.items, { text: '', or: [] }] })}>+ {t.addItem}</button>
            )}
          </div>

          <Text id={`${m.key}-notes`} label={t.notes} value={m.notes} max={500} set={(v) => setMeal(m.key, { notes: v })} />
          <div class="row">
            <button class="icon-btn" type="button" onClick={() => moveMeal(i, -1)} disabled={i === 0} aria-label={`${t.moveUp}: ${m.name || t.mealName}`}>↑</button>
            <button class="icon-btn" type="button" onClick={() => moveMeal(i, 1)} disabled={i === diet.meals.length - 1} aria-label={`${t.moveDown}: ${m.name || t.mealName}`}>↓</button>
            <button class="btn btn--small btn--danger" type="button" style="margin-left:auto" onClick={() => set({ ...diet, meals: diet.meals.filter((x) => x.key !== m.key) })}>{t.remove}</button>
          </div>
        </fieldset>
      ))}
      {diet.meals.length < 12 && (
        <button class="btn btn--ghost" type="button" onClick={() => set({ ...diet, meals: [...diet.meals, { key: key(), timeLabel: '', name: '', items: [{ text: '', or: [] }], notes: '' }] })}>
          + {t.addMeal}
        </button>
      )}

      <fieldset class="stack">
        <legend>{t.stockTitle}</legend>
        {diet.stock.map((s, i) => (
          <div class="row" key={i}>
            <label class="sr-only" for={`stock-e${i}`}>{t.stockEmoji}</label>
            <input id={`stock-e${i}`} value={s.emoji} maxLength={16} placeholder="🍌" style="width:64px;text-align:center" onInput={(e) => { const v = e.currentTarget.value; set({ ...diet, stock: diet.stock.map((x, j) => (j === i ? { ...x, emoji: v } : x)) }); }} />
            <label class="sr-only" for={`stock-l${i}`}>{t.stockLabel}</label>
            <input id={`stock-l${i}`} value={s.label} maxLength={40} placeholder={t.stockPlaceholder} onInput={(e) => { const v = e.currentTarget.value; set({ ...diet, stock: diet.stock.map((x, j) => (j === i ? { ...x, label: v } : x)) }); }} />
            <button class="icon-btn" type="button" aria-label={`${t.remove} ${s.label || t.stockLabel}`} onClick={() => set({ ...diet, stock: diet.stock.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        {diet.stock.length < 40 && (
          <button class="btn btn--small btn--ghost" type="button" style="align-self:flex-start" onClick={() => set({ ...diet, stock: [...diet.stock, { emoji: '', label: '' }] })}>+ {t.addStock}</button>
        )}
      </fieldset>

      <div class="field">
        <label for="diet-tips">{t.tipsTitle}</label>
        <textarea id="diet-tips" maxLength={2000} value={diet.tips} placeholder={t.tipsPlaceholder} onInput={(e) => set({ ...diet, tips: e.currentTarget.value })} />
      </div>
    </section>
  );
}

function Text({ id, label, value, set, max, placeholder }: { id: string; label: string; value: string; set: (v: string) => void; max: number; placeholder?: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} value={value} maxLength={max} placeholder={placeholder} onInput={(e) => set(e.currentTarget.value)} />
    </div>
  );
}
