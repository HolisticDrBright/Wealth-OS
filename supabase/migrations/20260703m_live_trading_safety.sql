-- ─── Live-trading safety reset (paper validation phase) ──────────────────────
-- live_enabled defaults to FALSE and every existing row is reset to FALSE:
-- no user/strategy can be live-enabled by accident. Live approval is an
-- explicit, deliberate action taken only after the paper-validation runbook
-- criteria pass. `is_enabled` is display enablement and never authorizes live.

ALTER TABLE public.user_enabled_strategies
  ADD COLUMN IF NOT EXISTS live_enabled boolean NOT NULL DEFAULT false;

-- Safety backfill: live trading has never legitimately run — reset everything.
UPDATE public.user_enabled_strategies SET live_enabled = false;

-- Explicit approval audit: who/when/why a strategy was ever live-approved.
CREATE TABLE IF NOT EXISTS public.live_approvals (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_key  text NOT NULL,
  approved      boolean NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.live_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own live approvals" ON public.live_approvals;
CREATE POLICY "users own live approvals"
  ON public.live_approvals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
