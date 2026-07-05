-- ─── Income-Growth pillar parameters (P3) ────────────────────────────────────
-- Thresholds live in kb_parameters (never hardcoded in rule code). Additive
-- and idempotent. income_context is a coaching jsonb like business_context —
-- never used in any dollar/tax/Monte-Carlo computation.

INSERT INTO public.kb_parameters (key, value, description, source) VALUES
  ('income_pillar_income_ceiling',       100000, 'Total income below which the income lever tends to dominate allocation', 'Income-Growth pillar (P3)'),
  ('income_pillar_investable_threshold', 100000, 'Investable assets below which allocation math cannot move the needle much', 'Income-Growth pillar (P3)'),
  ('income_pillar_min_savings_rate',     0.15,   'Savings-rate floor; below this with unfilled tax-advantaged room, income growth is prioritized', 'Income-Growth pillar (P3)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.financial_profile
  ADD COLUMN IF NOT EXISTS income_context jsonb NOT NULL DEFAULT '{}'::jsonb;
