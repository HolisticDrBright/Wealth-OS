-- Roadmap #4: retire losing strategies automatically.
--
-- 1. strategy_retirement_log — pre-existing gap: the weekly lifecycle job has
--    always inserted here, but no migration created the table, so every
--    switch-off left no record. Created if missing; columns added if an
--    out-of-band copy exists. Users read their own; the service role writes.
CREATE TABLE IF NOT EXISTS public.strategy_retirement_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_key  text NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_retirement_log ADD COLUMN IF NOT EXISTS rule text;
ALTER TABLE public.strategy_retirement_log ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS strategy_retirement_log_user_idx
  ON public.strategy_retirement_log (user_id, strategy_key, created_at DESC);
ALTER TABLE public.strategy_retirement_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own retirements" ON public.strategy_retirement_log;
CREATE POLICY "users read own retirements"
  ON public.strategy_retirement_log FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service role manages retirements" ON public.strategy_retirement_log;
CREATE POLICY "service role manages retirements"
  ON public.strategy_retirement_log FOR ALL USING (auth.role() = 'service_role');

-- 2. strategy_gate_snapshots — one row per person × strategy × review week:
--    did it pass its promotion gates (after-cost expectancy, drawdown)?
--    RETIRE_FAIL_WEEKS failing weeks in a row switch it off.
CREATE TABLE IF NOT EXISTS public.strategy_gate_snapshots (
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_key        text NOT NULL,
  week                date NOT NULL,
  closed_trades       integer NOT NULL DEFAULT 0,
  net_expectancy_pct  numeric,
  max_drawdown_pct    numeric,
  failing             boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, strategy_key, week)
);
ALTER TABLE public.strategy_gate_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own gate snapshots" ON public.strategy_gate_snapshots;
CREATE POLICY "users read own gate snapshots"
  ON public.strategy_gate_snapshots FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "service role manages gate snapshots" ON public.strategy_gate_snapshots;
CREATE POLICY "service role manages gate snapshots"
  ON public.strategy_gate_snapshots FOR ALL USING (auth.role() = 'service_role');
