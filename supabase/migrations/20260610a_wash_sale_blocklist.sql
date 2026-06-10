-- ─── wash_sale_blocklist: enforce the wash-sale rule after a harvest ─────────
--
-- When a tax-loss harvest is executed we record the symbol here.  Repurchasing
-- the same (or substantially identical) security within 30 days of the loss
-- sale disallows the loss (IRC §1091).  We block for 31 days to be safe
-- (the sale day itself plus the full 30-day window).
--
-- Rows are written by the harvest flow (lib/actions/harvest.ts) and read by
-- the wash-sale guard (lib/tax/wash-sale-guard.ts), which the rebalance
-- suggestion flow consults before suggesting BUYs.

CREATE TABLE IF NOT EXISTS public.wash_sale_blocklist (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol           text NOT NULL,
  asset_class      text NOT NULL,
  harvested_at     timestamptz NOT NULL DEFAULT now(),
  blocked_until    timestamptz NOT NULL,
  loss_amount_usd  numeric NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'released')),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.wash_sale_blocklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own wash sale blocklist" ON public.wash_sale_blocklist;
CREATE POLICY "users own wash sale blocklist"
  ON public.wash_sale_blocklist
  FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS wash_sale_blocklist_user_symbol_idx
  ON public.wash_sale_blocklist(user_id, symbol, blocked_until DESC);

CREATE INDEX IF NOT EXISTS wash_sale_blocklist_user_status_idx
  ON public.wash_sale_blocklist(user_id, status, blocked_until DESC);
