-- ============================================================
-- Wealth OS — Tier 2 Feature Definitions Migration
-- Adds dexter_research, financial_datasets_mcp, crucix,
-- and cex_latency_arb paper-trade gate support.
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── 1. ai_feature_definitions — Tier 2 integration entries ─────────────────

INSERT INTO public.ai_feature_definitions
  (feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd)
VALUES
  (
    'dexter_research',
    'Dexter SEC Filings & Earnings Transcripts',
    'virattt/dexter: autonomous researcher over SEC EDGAR filings, earnings transcripts, '
    'and analyst reports. Provides structured summaries for pead, spinoff, merger_arb, '
    'qvm_multifactor strategies. Runs as HTTP sidecar on DEXTER_URL (default localhost:7433). '
    'Requires Python: pip install dexter-research.',
    'ai_inference',
    0.05,    -- $0.05 per research call (1 LLM call approx)
    'call',
    1.50     -- $1.50 default monthly budget cap
  ),
  (
    'financial_datasets_mcp',
    'Financial Datasets MCP',
    'financial-datasets/mcp-server: typed financial data via MCP protocol. '
    'Income statements, balance sheets, cash flows, SEC filings, stock prices, '
    'earnings estimates. Free tier available; premium endpoints require FINANCIAL_DATASETS_API_KEY. '
    'Second MCP source alongside Vibe-Trading. Start: npx @financial-datasets/mcp-server --port 8766.',
    'premium_data',
    0.00,    -- free tier per call
    'call',
    15.00    -- $15/month subscription cost (premium tier)
  ),
  (
    'crucix',
    'Crucix On-Chain Whale Aggregator',
    'Polygon-native whale wallet movement tracker. Provides labeled on-chain flows '
    'with ~85%% wallet coverage for known actors (CEX hot wallets, Polymarket LPs, MEV bots). '
    'Used as supplementary signal for onchain_signal and polymarket_wallet_copy. '
    'Evaluation: docs/external/crucix-evaluation.md. '
    'Free tier: 1,000 req/day. Requires CRUCIX_API_KEY for premium.',
    'premium_data',
    0.00,    -- free tier
    'call',
    0.00     -- free tier; no budget needed
  )
ON CONFLICT (feature_key) DO UPDATE SET
  display_name       = EXCLUDED.display_name,
  description        = EXCLUDED.description,
  cost_per_use_usd   = EXCLUDED.cost_per_use_usd,
  default_budget_usd = EXCLUDED.default_budget_usd;

-- ─── 2. dexter_research_cache ───────────────────────────────────────────────
--
-- Caches Dexter research results to avoid re-fetching the same filing
-- within a 24-hour window. Reduces API costs and improves response time.
--
CREATE TABLE IF NOT EXISTS public.dexter_research_cache (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cached_at      timestamptz DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  ticker         text NOT NULL,
  research_type  text NOT NULL CHECK (research_type IN ('sec_filing', 'earnings_transcript', 'analyst_reports')),
  query_key      text NOT NULL,   -- e.g. "AAPL:10-K" or "TSLA:Q1 2026"
  result         jsonb NOT NULL,
  model_used     text,
  latency_ms     integer
);

CREATE UNIQUE INDEX IF NOT EXISTS dexter_cache_query_key_idx
  ON public.dexter_research_cache(ticker, research_type, query_key)
  WHERE expires_at > now();

CREATE INDEX IF NOT EXISTS dexter_cache_expires_idx
  ON public.dexter_research_cache(expires_at);

-- ─── 3. cex_latency_arb_paper_trades ────────────────────────────────────────
--
-- Tracks paper trades for the cex_latency_arb strategy during the mandatory
-- 30-day validation window before live capital is permitted.
-- Promotion gate: Sharpe > 1.5 AND max drawdown < 5%.
--
CREATE TABLE IF NOT EXISTS public.cex_latency_arb_paper_trades (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  detected_at     timestamptz NOT NULL,
  executed_at     timestamptz,
  exited_at       timestamptz,
  symbol          text NOT NULL,
  long_venue      text NOT NULL,
  short_venue     text NOT NULL,
  entry_spread_bps  numeric NOT NULL,
  exit_spread_bps   numeric,
  pnl_bps           numeric,  -- positive = profit
  pnl_usd           numeric,
  notional_usd      numeric NOT NULL,
  exit_reason     text CHECK (exit_reason IN ('convergence', 'hard_exit', 'manual', 'error')),
  leg_risk_event  boolean DEFAULT false,  -- true if one leg filled without the other
  metadata        jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS cex_paper_trades_symbol_idx
  ON public.cex_latency_arb_paper_trades(symbol, detected_at DESC);

-- ─── 4. user_enabled_strategies ─────────────────────────────────────────────
--
-- Tracks which users have explicitly opted into non-default strategies.
-- cex_latency_arb is default-disabled and requires a row here to activate.
--
CREATE TABLE IF NOT EXISTS public.user_enabled_strategies (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_key text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  enabled_by   text DEFAULT 'user',  -- 'user' | 'admin' | 'onboarding'
  notes        text,
  UNIQUE (user_id, strategy_key)
);

ALTER TABLE public.user_enabled_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own strategy settings"
  ON public.user_enabled_strategies FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "users manage own strategy settings"
  ON public.user_enabled_strategies FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own strategy settings"
  ON public.user_enabled_strategies FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "service role manages strategy settings"
  ON public.user_enabled_strategies FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS user_enabled_strategies_idx
  ON public.user_enabled_strategies(user_id, strategy_key)
  WHERE enabled = true;
