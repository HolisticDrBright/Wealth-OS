-- ============================================================
-- Wealth OS — Paper Trading Migration
-- paper_positions: one row per open/closed simulated position
-- paper_trades:    immutable fill log (open + close legs)
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── 1. paper_positions ──────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.paper_trades CASCADE;
DROP TABLE IF EXISTS public.paper_positions CASCADE;

CREATE TABLE IF NOT EXISTS public.paper_positions (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_key       text NOT NULL,
  symbol             text NOT NULL,
  asset_class        text NOT NULL,
  direction          text NOT NULL CHECK (direction IN ('long', 'short', 'neutral')),
  entry_price        numeric NOT NULL,
  current_price      numeric,
  exit_price         numeric,
  quantity           numeric NOT NULL,
  notional_usd       numeric NOT NULL,
  unrealized_pnl_usd numeric,
  unrealized_pnl_pct numeric,
  realized_pnl_usd   numeric,
  realized_pnl_pct   numeric,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'closed', 'stopped')),
  stop_loss_pct      numeric NOT NULL DEFAULT 0.02,   -- 2% default stop loss
  take_profit_pct    numeric NOT NULL DEFAULT 0.05,   -- 5% default take profit
  max_hold_hours     integer NOT NULL DEFAULT 24,     -- auto-close after 24h
  exit_reason        text CHECK (exit_reason IN ('take_profit','stop_loss','timeout','manual','signal')),
  metadata           jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own paper positions" ON public.paper_positions;
CREATE POLICY "users manage own paper positions"
  ON public.paper_positions FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service role manages paper positions" ON public.paper_positions;
CREATE POLICY "service role manages paper positions"
  ON public.paper_positions FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS paper_positions_user_status_idx
  ON public.paper_positions(user_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS paper_positions_strategy_idx
  ON public.paper_positions(user_id, strategy_key, opened_at DESC);

-- ─── 2. paper_trades ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.paper_trades (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id     uuid REFERENCES public.paper_positions(id) ON DELETE SET NULL,
  strategy_key    text NOT NULL,
  symbol          text NOT NULL,
  asset_class     text NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('long', 'short', 'neutral')),
  side            text NOT NULL CHECK (side IN ('open', 'close')),
  fill_price      numeric NOT NULL,
  quantity        numeric NOT NULL,
  notional_usd    numeric NOT NULL,
  slippage_bps    numeric NOT NULL DEFAULT 5,
  opportunity_id  text,
  metadata        jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own paper trades" ON public.paper_trades;
CREATE POLICY "users read own paper trades"
  ON public.paper_trades FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "service role manages paper trades" ON public.paper_trades;
CREATE POLICY "service role manages paper trades"
  ON public.paper_trades FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS paper_trades_user_idx
  ON public.paper_trades(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS paper_trades_position_idx
  ON public.paper_trades(position_id, created_at DESC);
CREATE INDEX IF NOT EXISTS paper_trades_strategy_idx
  ON public.paper_trades(user_id, strategy_key, created_at DESC);
