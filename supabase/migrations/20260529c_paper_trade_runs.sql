-- ─── paper_trade_runs: persist every paper trading pass ─────────────────────
--
-- Stores the full breakdown of each runPaperTradingPass() call so the Command
-- Center can show run history, skip diagnostics, and price feed health without
-- re-running the strategies. The skipped and skipped_details columns hold the
-- SkipCounts and SkippedDetail[] payloads serialized as JSONB.
--

CREATE TABLE IF NOT EXISTS public.paper_trade_runs (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  run_at               timestamptz NOT NULL,
  strategies_run       integer NOT NULL DEFAULT 0,
  opportunities_found  integer NOT NULL DEFAULT 0,
  decisions_execute    integer NOT NULL DEFAULT 0,
  decisions_block      integer NOT NULL DEFAULT 0,
  positions_opened     integer NOT NULL DEFAULT 0,
  positions_closed     integer NOT NULL DEFAULT 0,
  skipped              jsonb DEFAULT '{}',
  skipped_details      jsonb DEFAULT '[]',
  errors               jsonb DEFAULT '[]',
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE public.paper_trade_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users own paper runs" ON public.paper_trade_runs;
CREATE POLICY "users own paper runs"
  ON public.paper_trade_runs
  FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS paper_trade_runs_user_run_at_idx
  ON public.paper_trade_runs(user_id, run_at DESC);
