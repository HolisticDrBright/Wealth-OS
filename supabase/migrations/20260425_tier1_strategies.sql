-- ============================================================
-- Wealth OS — Tier 1 Strategy Layer Migration
-- Fully self-contained: works whether or not schema.sql was run.
-- Safe to re-run (idempotent).
-- ============================================================

-- ─── 1. audit_logs ───────────────────────────────────────────────────────────
--
-- Creates the table if it doesn't exist yet, then adds pipeline attribution
-- columns that the orchestrator and master-report query.
--
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_name    text NOT NULL DEFAULT '',
  trade_context jsonb,
  output        jsonb,
  duration_ms   integer,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
CREATE POLICY "Users can view own audit logs"
  ON public.audit_logs FOR SELECT USING (auth.uid() = user_id);

-- Pipeline attribution columns (idempotent)
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS strategy_key   text,
  ADD COLUMN IF NOT EXISTS edge_type      text,
  ADD COLUMN IF NOT EXISTS symbol         text,
  ADD COLUMN IF NOT EXISTS mirofish_used  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mirofish_score numeric,
  ADD COLUMN IF NOT EXISTS kronos_used    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS decision       text,
  ADD COLUMN IF NOT EXISTS size_fraction  numeric,
  ADD COLUMN IF NOT EXISTS decided_at     timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS audit_logs_strategy_key_idx
  ON public.audit_logs(strategy_key, decided_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_strategy_idx
  ON public.audit_logs(user_id, strategy_key, decided_at DESC);

-- ─── 2. kronos_forecasts ─────────────────────────────────────────────────────
--
-- User-scoped, strategy-aware forecast cache.
-- Written nightly by sync-kronos; read by kronos-confluence.ts.
-- Drops the old schema-less version if present.
--
DROP TABLE IF EXISTS public.kronos_forecasts CASCADE;

CREATE TABLE public.kronos_forecasts (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       timestamptz DEFAULT now(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol           text NOT NULL,
  strategy_key     text NOT NULL,
  skew             text NOT NULL CHECK (skew IN ('bullish', 'neutral', 'bearish')),
  skew_strength    numeric NOT NULL DEFAULT 0
                     CHECK (skew_strength BETWEEN -1 AND 1),
  p10              numeric NOT NULL,
  p50              numeric NOT NULL,
  p90              numeric NOT NULL,
  confidence_score numeric NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  generated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + INTERVAL '25 hours'
);

ALTER TABLE public.kronos_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own forecasts"
  ON public.kronos_forecasts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "service role manages forecasts"
  ON public.kronos_forecasts FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS kronos_forecasts_lookup_idx
  ON public.kronos_forecasts(user_id, symbol, strategy_key, expires_at DESC);
CREATE INDEX IF NOT EXISTS kronos_forecasts_expire_idx
  ON public.kronos_forecasts(expires_at);

-- ─── 3. ai_usage_logs ────────────────────────────────────────────────────────
--
-- Creates the table if absent, then adds columns FeatureFlagService.logUsage()
-- inserts: operation, tokens_in/out, latency_ms, trade_id, simulation_id.
--
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  timestamptz DEFAULT now(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feature_key text NOT NULL,
  cost_usd    numeric(10,6) NOT NULL DEFAULT 0,
  tokens_used integer,
  strategy    text,
  symbol      text,
  metadata    jsonb
);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own usage logs"      ON public.ai_usage_logs;
DROP POLICY IF EXISTS "service role insert usage logs" ON public.ai_usage_logs;
CREATE POLICY "users read own usage logs"
  ON public.ai_usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "service role insert usage logs"
  ON public.ai_usage_logs FOR INSERT WITH CHECK (true);

ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS operation     text,
  ADD COLUMN IF NOT EXISTS tokens_in     integer,
  ADD COLUMN IF NOT EXISTS tokens_out    integer,
  ADD COLUMN IF NOT EXISTS latency_ms    integer,
  ADD COLUMN IF NOT EXISTS trade_id      uuid,
  ADD COLUMN IF NOT EXISTS simulation_id uuid;

CREATE INDEX IF NOT EXISTS ai_usage_logs_user_month_idx
  ON public.ai_usage_logs(user_id, feature_key, created_at DESC);

-- ─── 4. ai_feature_definitions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_feature_definitions (
  feature_key         text PRIMARY KEY,
  display_name        text NOT NULL,
  description         text NOT NULL,
  category            text NOT NULL
    CHECK (category IN ('ai_confluence', 'premium_data')),
  cost_per_use_usd    numeric(10,6) NOT NULL DEFAULT 0,
  cost_unit           text NOT NULL DEFAULT 'call',
  default_budget_usd  numeric(10,2) NOT NULL DEFAULT 20.00,
  is_available        boolean NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.ai_feature_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone can read feature definitions"
  ON public.ai_feature_definitions;
CREATE POLICY "anyone can read feature definitions"
  ON public.ai_feature_definitions FOR SELECT USING (true);

-- Core AI features
INSERT INTO public.ai_feature_definitions
  (feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd)
VALUES
  ('mirofish',       'MiroFish AI',          'Claude-powered trade simulation and edge scoring',            'ai_confluence', 0.012000, 'call', 20.00),
  ('kronos',         'Kronos Forecaster',     'Self-hosted time-series ML model for directional forecasts', 'ai_confluence', 0.001000, 'call', 10.00),
  ('premium_prompt', 'Premium Prompt Model',  'Upgrades CIO calls from Haiku to Opus for high-stakes trades','ai_confluence', 0.015000, 'call', 30.00),
  ('glassnode',      'Glassnode On-Chain',    'Bitcoin/ETH on-chain metrics: NUPL, SOPR, exchange flows',  'premium_data',  0.033300, 'day',  10.00),
  ('nansen',         'Nansen Smart Money',    'Wallet clusters labeled as smart money for flow signals',   'premium_data',  0.066600, 'day',  20.00),
  ('unusual_whales', 'Unusual Whales Flow',   'Real-time options dark pool and congressional flow data',   'premium_data',  0.033300, 'day',  10.00),
  ('quiver',         'Quiver Quant',          'Congressional trades, government contracts, lobbying feeds', 'premium_data',  0.016600, 'day',   5.00),
  ('polygon',        'Polygon.io Premium',    'Sub-second tick data, full options chain, Level 2 book',    'premium_data',  0.083300, 'day',  25.00),
  -- Tier 1 strategy toggles (zero cost — just on/off gates)
  ('polymarket_wallet_copy',  'Polymarket Wallet Copy',  'Copy top Polymarket wallets via CLOB/Gamma APIs',          'ai_confluence', 0, 'call', 0),
  ('polymarket_info_lag',     'Polymarket Info Lag',     'Resolution-condition lag between condition IDs and prices', 'ai_confluence', 0, 'call', 0),
  ('autopilot_congressional', 'Congressional Flow',      'Congressional stock trades via Quiver Quant + House Clerk', 'ai_confluence', 0, 'call', 0),
  ('dca_halving',             'DCA Halving Cycle',       'BTC/ETH DCA sized by halving cycle phase',                 'ai_confluence', 0, 'call', 0),
  ('funding_basis_arb',       'Funding Basis Arb',       'Short perp + long spot when funding rate > threshold',     'ai_confluence', 0, 'call', 0)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  description        = EXCLUDED.description,
  cost_per_use_usd   = EXCLUDED.cost_per_use_usd,
  default_budget_usd = EXCLUDED.default_budget_usd;

-- ─── 5. ai_feature_flags ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_feature_flags (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feature_key         text REFERENCES public.ai_feature_definitions(feature_key)
                        ON DELETE CASCADE NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  monthly_budget_usd  numeric(10,2) NOT NULL DEFAULT 20.00,
  alert_threshold_pct numeric(5,2)  NOT NULL DEFAULT 80.00,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, feature_key)
);

ALTER TABLE public.ai_feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own feature flags" ON public.ai_feature_flags;
CREATE POLICY "users manage own feature flags"
  ON public.ai_feature_flags FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS ai_feature_flags_user_idx
  ON public.ai_feature_flags(user_id, feature_key);

-- ─── 6. get_monthly_spend function ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_monthly_spend(
  p_user_id    uuid,
  p_feature_key text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)
  FROM public.ai_usage_logs
  WHERE user_id     = p_user_id
    AND feature_key = p_feature_key
    AND created_at >= date_trunc('month', now());
$$;

-- ─── 7. user_copied_positions — strategy attribution ─────────────────────────

CREATE TABLE IF NOT EXISTS public.user_copied_positions (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol           text NOT NULL,
  asset_class      text NOT NULL,
  action           text NOT NULL,
  quantity         numeric,
  entry_price      numeric,
  current_price    numeric,
  notional_value   numeric DEFAULT 0,
  pnl_usd          numeric DEFAULT 0,
  pnl_pct          numeric DEFAULT 0,
  status           text DEFAULT 'pending'
                     CHECK (status IN ('pending','open','closed','failed')),
  broker           text,
  broker_order_id  text,
  error_message    text,
  opened_at        timestamptz DEFAULT now(),
  closed_at        timestamptz,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.user_copied_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own copied positions"
  ON public.user_copied_positions;
CREATE POLICY "Users can manage own copied positions"
  ON public.user_copied_positions FOR ALL USING (auth.uid() = user_id);

ALTER TABLE public.user_copied_positions
  ADD COLUMN IF NOT EXISTS strategy_key text,
  ADD COLUMN IF NOT EXISTS strategy_id  uuid;

CREATE INDEX IF NOT EXISTS ucp_user_id_idx
  ON public.user_copied_positions(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS ucp_strategy_key_idx
  ON public.user_copied_positions(strategy_key, opened_at DESC);

-- ─── 8. user_enabled_strategies ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_enabled_strategies (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_key text NOT NULL,
  is_enabled   boolean NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, strategy_key)
);

ALTER TABLE public.user_enabled_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own enabled strategies"
  ON public.user_enabled_strategies;
CREATE POLICY "users manage own enabled strategies"
  ON public.user_enabled_strategies FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_enabled_strategies_user_idx
  ON public.user_enabled_strategies(user_id, is_enabled);

-- ─── 9. user_watchlist ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_watchlist (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol       text NOT NULL,
  strategy_key text,
  interval     text DEFAULT '1d',
  notes        text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, symbol, strategy_key)
);

ALTER TABLE public.user_watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own watchlist" ON public.user_watchlist;
CREATE POLICY "users manage own watchlist"
  ON public.user_watchlist FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_watchlist_user_idx
  ON public.user_watchlist(user_id);

-- ─── 10. Realtime ─────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.kronos_forecasts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_enabled_strategies;
