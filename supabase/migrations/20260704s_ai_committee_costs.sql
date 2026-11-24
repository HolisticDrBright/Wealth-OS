-- Roadmap #7: what the AI committee costs, and whether its vetoes pay.
--
-- 1. llm_usage_log — one row per model call (real token usage × price),
--    including failed calls. Rows with user_id NULL are system calls (e.g.
--    Kronos) and hold no personal data; signed-in users can read them and
--    their own. Only the service role writes.
CREATE TABLE IF NOT EXISTS public.llm_usage_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  caller              text NOT NULL,
  agent_name          text,
  model               text NOT NULL,
  run_id              uuid,
  symbol              text,
  ok                  boolean NOT NULL DEFAULT true,
  latency_ms          integer,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cache_write_tokens  integer NOT NULL DEFAULT 0,
  cache_read_tokens   integer NOT NULL DEFAULT 0,
  cost_usd            numeric,
  error               text
);
CREATE INDEX IF NOT EXISTS llm_usage_log_created_idx ON public.llm_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_log_run_idx ON public.llm_usage_log (run_id);
ALTER TABLE public.llm_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read own and system llm usage" ON public.llm_usage_log;
CREATE POLICY "read own and system llm usage"
  ON public.llm_usage_log FOR SELECT
  USING (auth.uid() IS NOT NULL AND (user_id IS NULL OR user_id = auth.uid()));
DROP POLICY IF EXISTS "service role manages llm usage" ON public.llm_usage_log;
CREATE POLICY "service role manages llm usage"
  ON public.llm_usage_log FOR ALL USING (auth.role() = 'service_role');

-- 2. committee_runs — every copy-trade committee decision with each agent's
--    vote and the price then; graded COMMITTEE_GRADE_HORIZON_DAYS later.
CREATE TABLE IF NOT EXISTS public.committee_runs (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol          text NOT NULL,
  asset_class     text NOT NULL,
  action          text NOT NULL,
  notional_usd    numeric NOT NULL DEFAULT 0,
  decision        text NOT NULL,
  votes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  scores          jsonb NOT NULL DEFAULT '{}'::jsonb,
  entry_price     numeric,
  exit_price      numeric,
  outcome_return  numeric,
  ungradable      boolean NOT NULL DEFAULT false,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  graded_at       timestamptz
);
CREATE INDEX IF NOT EXISTS committee_runs_user_idx ON public.committee_runs (user_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS committee_runs_ungraded_idx ON public.committee_runs (decided_at) WHERE graded_at IS NULL;
ALTER TABLE public.committee_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own committee runs" ON public.committee_runs;
CREATE POLICY "users read own committee runs"
  ON public.committee_runs FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service role manages committee runs" ON public.committee_runs;
CREATE POLICY "service role manages committee runs"
  ON public.committee_runs FOR ALL USING (auth.role() = 'service_role');

-- 3. committee_agent_settings — agents a person turned off (owner RLS).
CREATE TABLE IF NOT EXISTS public.committee_agent_settings (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  reason      text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, agent_name)
);
ALTER TABLE public.committee_agent_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own committee settings" ON public.committee_agent_settings;
CREATE POLICY "users manage own committee settings"
  ON public.committee_agent_settings FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 4. Turning an agent off is an approval like any other.
ALTER TABLE public.automation_approvals
  DROP CONSTRAINT IF EXISTS automation_approvals_kind_check;
ALTER TABLE public.automation_approvals
  ADD CONSTRAINT automation_approvals_kind_check
  CHECK (kind IN ('enable_strategy','follow_trader','auto_copy','accept_rebalance','setup_ladder',
                  'core_rebalance','deposit','explore_shrink','cut_agent'));
