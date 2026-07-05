-- ─── financial_profile.business_context (P2 Owner Dependency Audit) ──────────
-- Free-form coaching context (weekly owner tasks, failed delegations, two-week
-- absence breakage, selected task). NEVER used in any dollar/tax computation
-- or Monte Carlo — coaching inputs only. Additive; default empty.

ALTER TABLE public.financial_profile
  ADD COLUMN IF NOT EXISTS business_context jsonb NOT NULL DEFAULT '{}'::jsonb;
