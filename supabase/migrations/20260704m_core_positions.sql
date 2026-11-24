-- Wealth-manager allocation, Phase 3: make Core real (paper).
--
-- Core and Tier 1 Safety holdings are paper_positions rows with the reserved
-- strategy_key 'core' / 'safety' (no new column — see lib/allocation/sleeves.ts).

-- 1. exit_reason: allow the pause close-out ('manual_flatten') and Core lot
--    sells ('rebalance'). Pre-existing bug fix: Flatten & Halt has written
--    'manual_flatten' since Phase 1 and the old CHECK rejected it, so pauses
--    never actually closed positions against a real database.
ALTER TABLE public.paper_positions DROP CONSTRAINT IF EXISTS paper_positions_exit_reason_check;
ALTER TABLE public.paper_positions ADD CONSTRAINT paper_positions_exit_reason_check
  CHECK (exit_reason IN ('take_profit','stop_loss','timeout','manual','signal','manual_flatten','rebalance'));

-- 2. Fast lookups of a user's open holdings by sleeve key.
CREATE INDEX IF NOT EXISTS paper_positions_user_key_status_idx
  ON public.paper_positions (user_id, strategy_key, status);

-- 3. Deposits: new practice money. Allocated Tier 1 first, then Core (the
--    fund furthest below target). Counted in investable money for the ladder;
--    never added to strategy equity, so it cannot enlarge a strategy position.
CREATE TABLE IF NOT EXISTS public.paper_deposits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_usd  numeric NOT NULL CHECK (amount_usd > 0),
  allocation  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_deposits_user_idx ON public.paper_deposits (user_id, created_at DESC);

ALTER TABLE public.paper_deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own paper deposits" ON public.paper_deposits;
CREATE POLICY "users manage own paper deposits"
  ON public.paper_deposits FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. Core rebalances are approvals like any other.
ALTER TABLE public.automation_approvals
  DROP CONSTRAINT IF EXISTS automation_approvals_kind_check;
ALTER TABLE public.automation_approvals
  ADD CONSTRAINT automation_approvals_kind_check
  CHECK (kind IN ('enable_strategy','follow_trader','auto_copy','accept_rebalance','setup_ladder','core_rebalance','deposit'));

-- 5. Fund-trade log rows. paper_trades only lets the service role write, so
--    trades a user approves on the web or phone (their own RLS session) were
--    silently dropped from the log. Allow users to INSERT their OWN rows for
--    the reserved ladder keys only — strategy trade rows stay service-role.
DROP POLICY IF EXISTS "users insert own ladder paper trades" ON public.paper_trades;
CREATE POLICY "users insert own ladder paper trades"
  ON public.paper_trades FOR INSERT
  WITH CHECK (auth.uid() = user_id AND strategy_key IN ('core','safety'));
