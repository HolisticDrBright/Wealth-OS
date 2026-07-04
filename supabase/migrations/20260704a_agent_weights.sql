-- ─── agent_weights: calibrated committee vote weights (W4) ───────────────────
-- Written by the weekly agent-calibration cron; read by CIODecisionEngine
-- with the hardcoded map as fallback. System-wide (not per-user) — the
-- committee is one system.

CREATE TABLE IF NOT EXISTS public.agent_weights (
  agent_name  text PRIMARY KEY,
  weight      numeric NOT NULL CHECK (weight > 0 AND weight <= 1),
  samples     integer NOT NULL DEFAULT 0,
  accuracy    numeric CHECK (accuracy IS NULL OR (accuracy >= 0 AND accuracy <= 1)),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read agent weights" ON public.agent_weights;
CREATE POLICY "read agent weights" ON public.agent_weights FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "service writes agent weights" ON public.agent_weights;
CREATE POLICY "service writes agent weights" ON public.agent_weights FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
