-- Migration: register deep-scan strategies in strategy_definitions catalog (idempotent)
-- Source: Strategy Analysis 2026-05-09 - Deep Scan

INSERT INTO public.strategy_definitions (strategy_key, display_name, enabled_in_profiles, default_paper_enabled, default_live_enabled, maturity_status, source_doc)
VALUES
  (
    'ibit_vol_skew',
    'IBIT Vol Skew',
    ARRAY['balanced', 'growth', 'speculative'],
    false,
    false,
    'stub',
    'Strategy Analysis 2026-05-09 - Deep Scan'
  ),
  (
    'factor_crowded_trade_fade',
    'Factor Crowded Trade Fade',
    ARRAY['balanced', 'growth', 'speculative'],
    false,
    false,
    'stub',
    'Strategy Analysis 2026-05-09 - Deep Scan'
  )
ON CONFLICT (strategy_key) DO UPDATE
  SET maturity_status       = EXCLUDED.maturity_status,
      default_paper_enabled = EXCLUDED.default_paper_enabled,
      default_live_enabled  = EXCLUDED.default_live_enabled,
      source_doc            = EXCLUDED.source_doc;
