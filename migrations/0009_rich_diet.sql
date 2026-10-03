-- Richer diet plans. Additive only: existing meals keep their free-text
-- `items`, which is still shown (and still written, flattened) so older
-- rows render as before.

-- Meals: a time-slot label ("Early morning"); the heading stays in `name`.
-- items_json is [{"text": "...", "or": ["alternative", ...]}]; NULL means the
-- meal predates this and only has the free-text `items`.
ALTER TABLE plan_meals ADD COLUMN time_label TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_meals ADD COLUMN items_json TEXT;

-- Diet header, general tips, and the "keep stocked" list
-- ([{"emoji": "🍌", "label": "Bananas"}]).
ALTER TABLE plans ADD COLUMN diet_title TEXT NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN diet_intro TEXT NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN diet_tips  TEXT NOT NULL DEFAULT '';
ALTER TABLE plans ADD COLUMN stock_json TEXT NOT NULL DEFAULT '[]';
