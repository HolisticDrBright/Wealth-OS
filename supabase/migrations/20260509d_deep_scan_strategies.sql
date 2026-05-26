-- Migration: register deep-scan strategies (default-disabled)
-- Source: Strategy Analysis 2026-05-09 - Deep Scan

INSERT INTO user_enabled_strategies (strategy_key, enabled_by_default, source_doc)
VALUES
  ('ibit_vol_skew',             false, 'Strategy Analysis 2026-05-09 - Deep Scan'),
  ('factor_crowded_trade_fade', false, 'Strategy Analysis 2026-05-09 - Deep Scan')
ON CONFLICT (strategy_key) DO NOTHING;
