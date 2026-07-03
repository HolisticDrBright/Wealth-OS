-- ─── Polymarket corpus aggregates (Gap brief A2) ─────────────────────────────
-- Bulk data (107GB) lives OUTSIDE Supabase (parquet + DuckDB, scripts/poly-corpus).
-- Only nightly aggregates are promoted here.

CREATE TABLE IF NOT EXISTS public.wallet_stats (
  wallet            text PRIMARY KEY,
  sharpe_60d        numeric,
  win_rate_30d      numeric,
  calibration_brier numeric,
  n_trades          integer NOT NULL DEFAULT 0,
  recertified_at    timestamptz,
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.category_bias (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category      text NOT NULL,
  price_bucket  numeric NOT NULL,   -- e.g. 0.05 for [0, 0.1)
  realized_freq numeric NOT NULL,
  n             integer NOT NULL,
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (category, price_bucket)
);

CREATE TABLE IF NOT EXISTS public.hourly_liquidity (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  market_type  text NOT NULL,
  utc_hour     integer NOT NULL CHECK (utc_hour BETWEEN 0 AND 23),
  avg_spread   numeric,
  depth        numeric,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (market_type, utc_hour)
);

ALTER TABLE public.wallet_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_bias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_liquidity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read wallet stats" ON public.wallet_stats;
CREATE POLICY "authenticated read wallet stats" ON public.wallet_stats FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "authenticated read category bias" ON public.category_bias;
CREATE POLICY "authenticated read category bias" ON public.category_bias FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "authenticated read hourly liquidity" ON public.hourly_liquidity;
CREATE POLICY "authenticated read hourly liquidity" ON public.hourly_liquidity FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
