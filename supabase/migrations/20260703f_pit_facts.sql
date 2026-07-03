-- ─── pit_facts: point-in-time fact store (Gap brief A1) ──────────────────────
-- Facts are APPEND-ONLY, stored as-known-on-date, never restated. Queries take
-- asOf and see only rows with as_of <= asOf — the single most institutional
-- habit: without it every backtest silently cheats (restatement bias).
CREATE TABLE IF NOT EXISTS public.pit_facts (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity       text NOT NULL,           -- e.g. 'AAPL', 'tax:2026', 'BTC-PERP'
  key          text NOT NULL,           -- e.g. 'eps_ttm', 'ira_limit'
  value        jsonb NOT NULL,
  as_of        timestamptz NOT NULL,    -- when the fact became KNOWN
  source       text,
  ingested_at  timestamptz DEFAULT now()
);

-- Append-only: no UPDATE/DELETE policies exist, and the lookup index serves
-- "latest as_of <= asOf" queries.
CREATE INDEX IF NOT EXISTS pit_facts_lookup_idx
  ON public.pit_facts(entity, key, as_of DESC);

ALTER TABLE public.pit_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read pit facts" ON public.pit_facts;
CREATE POLICY "authenticated read pit facts"
  ON public.pit_facts FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "service role appends pit facts" ON public.pit_facts;
CREATE POLICY "service role appends pit facts"
  ON public.pit_facts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
