-- Migration: register odte_strangle_hedged in strategy_definitions catalog (idempotent)
INSERT INTO public.strategy_definitions (strategy_key, display_name, enabled_in_profiles, default_paper_enabled, default_live_enabled, maturity_status, source_doc)
VALUES (
  'odte_strangle_hedged',
  '0DTE Strangle Hedged',
  ARRAY['growth', 'speculative'],
  false,
  false,
  'stub',
  NULL
)
ON CONFLICT (strategy_key) DO UPDATE
  SET maturity_status       = EXCLUDED.maturity_status,
      default_paper_enabled = EXCLUDED.default_paper_enabled,
      default_live_enabled  = EXCLUDED.default_live_enabled;
