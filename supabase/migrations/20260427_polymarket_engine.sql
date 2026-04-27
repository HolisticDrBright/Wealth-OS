-- ============================================================
-- Wealth OS — Polymarket Engine Migration
-- Adds polymarket_engine feature definition and supporting
-- indexes for the polymarket_crypto_binary_5min strategy.
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── 1. ai_feature_definitions — polymarket_engine entry ────────────────────

INSERT INTO public.ai_feature_definitions
  (feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd)
VALUES
  (
    'polymarket_engine',
    'Polymarket Trade Engine',
    'KaustubhPatange/polymarket-trade-engine: Python REST wrapper around the Polymarket CLOB API. '
    'Provides order placement, order book subscription, fill detection, and PnL reporting for '
    'BTC/ETH/SOL/XRP/DOGE 5-min and 15-min binary price markets. '
    'Required by polymarket_crypto_binary_5min strategy. '
    'Runs as a local HTTP sidecar on POLYMARKET_ENGINE_URL (default localhost:7432).',
    'premium_data',
    0.05,   -- $0.05 estimated compute cost per order-placement call
    'call',
    5.00    -- $5 default monthly budget cap
  )
ON CONFLICT (feature_key) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  description        = EXCLUDED.description,
  cost_per_use_usd   = EXCLUDED.cost_per_use_usd,
  default_budget_usd = EXCLUDED.default_budget_usd;

-- ─── 2. audit_logs indexes — polymarket strategy queries ────────────────────
--
-- The calibration page and health route both filter audit_logs by
-- strategy_key + decided_at. Ensure these are indexed.
--
CREATE INDEX IF NOT EXISTS audit_logs_strategy_decided_idx
  ON public.audit_logs(strategy_key, decided_at DESC);

-- Edge-type index for cross-strategy edge analysis
CREATE INDEX IF NOT EXISTS audit_logs_edge_type_idx
  ON public.audit_logs((metadata->>'edge_type'), decided_at DESC);

-- ─── 3. user_copied_positions indexes ────────────────────────────────────────
--
-- Health route queries by strategy_key + opened_at for 30-day PnL.
--
CREATE INDEX IF NOT EXISTS positions_strategy_opened_idx
  ON public.user_copied_positions(strategy_key, opened_at DESC)
  WHERE pnl_pct IS NOT NULL;

-- ─── 4. polymarket_engine_fills (optional append-only table) ─────────────────
--
-- Optional: stores raw fill events from the engine for audit trail.
-- The strategy writes fills to audit_logs.metadata; this table provides
-- a dedicated queryable surface if needed.
--
CREATE TABLE IF NOT EXISTS public.polymarket_engine_fills (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recorded_at     timestamptz DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_key    text NOT NULL DEFAULT 'polymarket_crypto_binary_5min',
  market_id       text NOT NULL,
  condition_id    text NOT NULL,
  order_id        text NOT NULL,
  side            text NOT NULL CHECK (side IN ('buy', 'sell')),
  price           numeric NOT NULL,
  size            numeric NOT NULL,
  fee_cents       integer NOT NULL DEFAULT 0,
  filled_at       timestamptz NOT NULL,
  exit_order_id   text,           -- pre-armed limit sell order id
  hard_exit       boolean DEFAULT false,
  pnl_usdc        numeric,        -- filled in after exit
  metadata        jsonb DEFAULT '{}'
);

ALTER TABLE public.polymarket_engine_fills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own fills" ON public.polymarket_engine_fills;
CREATE POLICY "users read own fills"
  ON public.polymarket_engine_fills FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service role manages fills" ON public.polymarket_engine_fills;
CREATE POLICY "service role manages fills"
  ON public.polymarket_engine_fills FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS poly_fills_user_strategy_idx
  ON public.polymarket_engine_fills(user_id, strategy_key, filled_at DESC);
CREATE INDEX IF NOT EXISTS poly_fills_market_idx
  ON public.polymarket_engine_fills(market_id, filled_at DESC);
