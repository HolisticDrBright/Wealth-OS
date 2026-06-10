-- ─── paper_trade_runs.regime: record the market regime at run time ──────────
--
-- Stored per run so the runner can detect regime *changes* between runs and
-- emit an alert (auto-alerts), and so run history shows which regime each
-- pass executed under.

ALTER TABLE public.paper_trade_runs
  ADD COLUMN IF NOT EXISTS regime text;
