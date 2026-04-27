-- ============================================================
-- Wealth OS — Order Book Imbalance Migration
-- Adds polygon_l2 feature definition for stock L2 depth data
-- used by the orderBookImbalance pre-entry-confirm confluence.
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── 1. ai_feature_definitions — polygon_l2 ──────────────────────────────────

INSERT INTO public.ai_feature_definitions
  (feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd)
VALUES
  (
    'polygon_l2',
    'Polygon.io Level 2 Quote Depth',
    'NASDAQ TotalView L2 snapshot via Polygon.io. Used by the orderBookImbalance confluence gate '
    'for stock strategies (vcp_minervini, pead, gamma_exposure). '
    'Falls back to IEX Deep free tier (IEX_CLOUD_API_KEY) when budget is exhausted. '
    'Requires POLYGON_API_KEY environment variable.',
    'premium_data',
    0.001,   -- $0.001 per snapshot call (subscription amortised)
    'call',
    5.00     -- $5/month default budget cap
  )
ON CONFLICT (feature_key) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  description        = EXCLUDED.description,
  cost_per_use_usd   = EXCLUDED.cost_per_use_usd,
  default_budget_usd = EXCLUDED.default_budget_usd;

-- ─── 2. imbalance_snapshots (optional logging table) ─────────────────────────
--
-- Records imbalance verdicts for A/B analysis of the pre-entry-confirm gate.
-- Enables calibration page to show: win rate WITH imbalance filter vs WITHOUT.
--
CREATE TABLE IF NOT EXISTS public.imbalance_snapshots (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recorded_at   timestamptz DEFAULT now(),
  strategy_key  text NOT NULL,
  symbol        text NOT NULL,
  venue         text NOT NULL,
  signal        text NOT NULL CHECK (signal IN ('bull', 'bear', 'neutral')),
  ratio         numeric NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('long', 'short')),
  opposes       boolean NOT NULL DEFAULT false,
  decision      text CHECK (decision IN ('block', 'reduce_size', 'pass', 'skip'))
);

CREATE INDEX IF NOT EXISTS imbalance_strategy_idx
  ON public.imbalance_snapshots(strategy_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS imbalance_signal_idx
  ON public.imbalance_snapshots(signal, opposes, recorded_at DESC);
