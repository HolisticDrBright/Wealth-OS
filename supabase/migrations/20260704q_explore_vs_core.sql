-- Roadmap #3: Explore must beat Core.
--
-- 1. A smaller Explore limit, proposed because Explore trailed Core, is an
--    approval like any other (kind 'explore_shrink'). It only ever LOWERS the
--    limit; nothing is sold.
ALTER TABLE public.automation_approvals
  DROP CONSTRAINT IF EXISTS automation_approvals_kind_check;
ALTER TABLE public.automation_approvals
  ADD CONSTRAINT automation_approvals_kind_check
  CHECK (kind IN ('enable_strategy','follow_trader','auto_copy','accept_rebalance','setup_ladder',
                  'core_rebalance','deposit','explore_shrink'));

-- 2. "Not now" on the shrink proposal snoozes it.
CREATE TABLE IF NOT EXISTS public.explore_review_state (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  snoozed_until  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.explore_review_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own explore review state" ON public.explore_review_state;
CREATE POLICY "users manage own explore review state"
  ON public.explore_review_state FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
