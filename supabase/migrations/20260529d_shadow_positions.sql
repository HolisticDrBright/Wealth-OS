-- ─── shadow_positions: track what Wealth OS refused to trade ────────────────
--
-- When the CIO pipeline blocks an opportunity (risk veto, profile mismatch,
-- venue gate, etc.), we create a shadow position at the rejection price.
-- By marking these to market over time we can answer: "Would the rejected
-- trades have outperformed the accepted ones?"  This is the primary calibration
-- signal for the decision gates.
--
-- Only blocks where we have a real market price are shadow-tracked.
-- Already-open, missing-price, and expired-market skips are excluded.
--

CREATE TABLE IF NOT EXISTS public.shadow_positions (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_key         text NOT NULL,
  symbol               text NOT NULL,
  asset_class          text NOT NULL,
  direction            text NOT NULL DEFAULT 'long',
  would_have_price     numeric NOT NULL,
  would_have_notional  numeric NOT NULL DEFAULT 500,
  would_have_quantity  numeric NOT NULL,
  skip_reason          text NOT NULL,
  skip_detail          text,
  stop_loss_pct        numeric NOT NULL DEFAULT 0.02,
  take_profit_pct      numeric NOT NULL DEFAULT 0.05,
  max_hold_hours       integer NOT NULL DEFAULT 72,
  status               text NOT NULL DEFAULT 'open',
  current_price        numeric,
  exit_price           numeric,
  unrealized_pnl_usd   numeric,
  unrealized_pnl_pct   numeric,
  realized_pnl_usd     numeric,
  realized_pnl_pct     numeric,
  exit_reason          text,
  created_at           timestamptz DEFAULT now(),
  resolved_at          timestamptz
);

ALTER TABLE public.shadow_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own shadow positions" ON public.shadow_positions;
CREATE POLICY "users own shadow positions"
  ON public.shadow_positions
  FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS shadow_positions_user_status_idx
  ON public.shadow_positions(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS shadow_positions_user_created_idx
  ON public.shadow_positions(user_id, created_at DESC);
