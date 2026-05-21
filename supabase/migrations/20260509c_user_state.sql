-- Migration: state-of-residence gating for prediction markets
-- Adds state_of_residence to profiles and creates ban table for Polymarket/Kalshi.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS state_of_residence text;

-- Venue-level bans per US state
CREATE TABLE IF NOT EXISTS public.prediction_market_state_bans (
  id          uuid  DEFAULT gen_random_uuid() PRIMARY KEY,
  state_code  text  NOT NULL,           -- 2-letter ISO 3166-2 subdivision (e.g. 'MN')
  venue       text  NOT NULL,           -- 'polymarket' | 'kalshi' | etc.
  effective   date  NOT NULL,
  notes       text,
  UNIQUE (state_code, venue)
);

ALTER TABLE public.prediction_market_state_bans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON public.prediction_market_state_bans;
CREATE POLICY "Public read"
  ON public.prediction_market_state_bans
  FOR SELECT USING (true);

-- Minnesota ban effective 2026-06-01 (HF No. 3248, signed 2026-04-15)
INSERT INTO public.prediction_market_state_bans (state_code, venue, effective, notes) VALUES
  ('MN', 'polymarket', '2026-06-01', 'Minnesota HF No. 3248 — retail prediction market ban'),
  ('MN', 'kalshi',     '2026-06-01', 'Minnesota HF No. 3248 — retail prediction market ban')
ON CONFLICT (state_code, venue) DO NOTHING;
