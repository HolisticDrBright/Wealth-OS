-- ─── research_proposals: Strategy-Scientist ideation output (R&D layer) ──────
-- Purely advisory. NOTHING here trades. alpha_hypothesis rows are the
-- "stub registry" for research — maturity is pinned to 'stub' by a CHECK so a
-- filed hypothesis can never be mistaken for a tradable strategy. Proposals
-- are FILED, never applied; a human (or the post-burn-in walk-forward runner)
-- moves them through the status workflow.

CREATE TABLE IF NOT EXISTS public.research_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  kind             text NOT NULL CHECK (kind IN ('risk_reward','optimization','alpha_hypothesis')),
  strategy_id      text,
  market           text,
  title            text NOT NULL,
  body             jsonb NOT NULL DEFAULT '{}',
  param_grid_patch jsonb,
  -- Research stubs NEVER trade — the CHECK makes that structural.
  maturity         text NOT NULL DEFAULT 'stub' CHECK (maturity = 'stub'),
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','accepted','backtested','rejected','promoted')),
  metadata         jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.research_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read research proposals" ON public.research_proposals;
CREATE POLICY "read research proposals" ON public.research_proposals FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "service writes research proposals" ON public.research_proposals;
CREATE POLICY "service writes research proposals" ON public.research_proposals FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS research_proposals_kind_status_idx
  ON public.research_proposals(kind, status, created_at DESC);
