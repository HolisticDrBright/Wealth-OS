-- Phase 4.3: approval-before-automation. In simple mode nothing new starts
-- trading automatically: enabling a strategy, following a trader, turning on
-- auto-copy, or accepting a rebalance shows a plain-language summary and
-- requires explicit approval, which is recorded here.
CREATE TABLE IF NOT EXISTS public.automation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('enable_strategy','follow_trader','auto_copy','accept_rebalance')),
  subject text NOT NULL,              -- strategy key / trader id / 'rebalance'
  summary text NOT NULL,              -- the plain-language text the user approved
  metadata jsonb DEFAULT '{}'::jsonb,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_approvals_user_idx
  ON public.automation_approvals (user_id, kind, subject);

ALTER TABLE public.automation_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own automation approvals" ON public.automation_approvals;
CREATE POLICY "users manage own automation approvals"
  ON public.automation_approvals FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
