-- ─── audit_logs: add missing pipeline verdict columns ────────────────────────
--
-- BasePipelineStrategy.logAudit() inserts red_team_score and kronos_pass but
-- the 20260425_tier1_strategies migration never added them, causing every
-- audit insert to fail with a schema-cache error. This migration adds both
-- columns idempotently so existing rows are unaffected.
--

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS red_team_score numeric,
  ADD COLUMN IF NOT EXISTS kronos_pass    boolean;
