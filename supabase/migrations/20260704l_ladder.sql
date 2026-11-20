-- Wealth-manager allocation, Phase 2: the three-tier ladder.
--
-- ladder_state holds the Tier 1 (Safety) money a user designated by approving
-- the one-tap "Set up your ladder" decision — a paper move of existing money
-- into the cash-like tier. Monthly expenses live in the existing
-- financial_profile.monthly_essential_expenses_usd column (no new field).

CREATE TABLE IF NOT EXISTS public.ladder_state (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier1_designated_usd  numeric NOT NULL DEFAULT 0 CHECK (tier1_designated_usd >= 0),
  setup_approved_at     timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ladder_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own ladder state" ON public.ladder_state;
CREATE POLICY "users manage own ladder state"
  ON public.ladder_state FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- The ladder setup is an approval like any other: allow its kind.
ALTER TABLE public.automation_approvals
  DROP CONSTRAINT IF EXISTS automation_approvals_kind_check;
ALTER TABLE public.automation_approvals
  ADD CONSTRAINT automation_approvals_kind_check
  CHECK (kind IN ('enable_strategy','follow_trader','auto_copy','accept_rebalance','setup_ladder'));
