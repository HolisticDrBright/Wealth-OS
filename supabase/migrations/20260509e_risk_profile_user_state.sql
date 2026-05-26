-- Migration: verify risk profile tables and re-seed default profiles (idempotent)

-- Ensure user_risk_profile has required columns
ALTER TABLE public.user_risk_profile
  ADD COLUMN IF NOT EXISTS profile_key       text,
  ADD COLUMN IF NOT EXISTS ui_mode           text DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS current_mode      text GENERATED ALWAYS AS (ui_mode) STORED;

-- Re-seed 5 default profiles if missing
INSERT INTO public.risk_profiles
  (profile_key, display_name, description, sort_order)
VALUES
  ('vault',        'Vault',        'Capital preservation above all else. Very low risk, very low volatility.',           1),
  ('conservative', 'Conservative', 'Slow, steady income with minimal drawdown. Sleep-well-at-night money.',              2),
  ('balanced',     'Balanced',     'Equal emphasis on growth and protection. The sensible default.',                     3),
  ('growth',       'Growth',       'Prioritise returns over stability. Comfortable with larger swings.',                 4),
  ('speculative',  'Speculative',  'Maximum upside. Full strategy access. Only with money you can afford to lose.',      5)
ON CONFLICT (profile_key) DO NOTHING;
