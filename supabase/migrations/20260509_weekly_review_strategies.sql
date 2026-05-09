-- Weekly Review 2026-05-09 — strategy scaffold rows
-- Adds two optional columns (idempotent) then inserts 8 default-disabled strategies.

ALTER TABLE strategy_definitions ADD COLUMN IF NOT EXISTS default_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE strategy_definitions ADD COLUMN IF NOT EXISTS source_doc text;

INSERT INTO strategy_definitions
  (strategy_key, layman_name, plain_english_description, enabled_in_profiles, asset_class, requires_advanced_warning, default_enabled, source_doc)
VALUES
  (
    'pead_microcap_text',
    'PEAD Microcap Text',
    'PEAD-Microcap with earnings-call sentiment overlay. Fires when market cap < $500M, SUE > 1.5σ, polarity > +0.3 or < -0.3.',
    ARRAY['growth','speculative'],
    'stocks',
    false,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'vix_term_structure',
    'VIX Term Structure',
    'Sell weekly SPX 30-delta put-spreads when VIX9D - VIX1D > 3 and VIX < 22 and 5d RV < implied. Roll weekly, target 50% max profit, stop 2x credit.',
    ARRAY['balanced','growth'],
    'options',
    true,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'funding_basis_arb_hyperliquid',
    'Funding Basis Arb (Hyperliquid)',
    'Hyperliquid hourly-funding extension. Routes the short leg to HL when HL funding - CEX funding > 0.5 bps/hour and HL liquidity at 50bps within 5% of CEX leg. Cap $250k.',
    ARRAY['conservative','balanced','growth','speculative'],
    'crypto',
    false,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'pendle_pt_fixed_yield',
    'Pendle PT Fixed Yield',
    'Pendle PT-sUSDe fixed-yield lock when sUSDe APY < 9.5% AND PT yield > 8.0% AND maturity < 90d. Hold to maturity.',
    ARRAY['vault','conservative','balanced','growth'],
    'crypto',
    false,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'month_end_fix',
    'Month-End Fix',
    'Month-end 4pm London fix flow. Last trading day, if S&P − MSCI ex-US monthly return spread > 2%, fade USD on the fix bar. Hold 60-90 min.',
    ARRAY['vault','conservative','balanced','growth','speculative'],
    'forex',
    false,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'jpy_intervention_fade',
    'JPY Intervention Fade',
    'USDJPY > 157 + spec net-short futures > 1.5σ + RSI14 > 70 → build short. Stop 161.50, target 152, scale on confirmed verbal intervention.',
    ARRAY['balanced','growth','speculative'],
    'forex',
    false,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'cross_platform_sports_arb',
    'Cross-Platform Sports Arb',
    'Polymarket+Kalshi sports stale-line arb. Execute two-leg arb when YES+NO < $0.94. Hold to resolution.',
    ARRAY['vault','conservative','balanced','growth','speculative'],
    'polymarket',
    false,
    false,
    'Weekly Review 2026-05-09'
  ),
  (
    'polymarket_theta_decay',
    'Polymarket Theta Decay',
    'Sell Yes (buy No) on Polymarket markets where days-to-deadline >= 30, Yes >= 1.3x base rate, liquidity > $50k. Exit at base rate or T-7 days.',
    ARRAY['balanced','growth','speculative'],
    'polymarket',
    false,
    false,
    'Weekly Review 2026-05-09'
  )
ON CONFLICT (strategy_key) DO NOTHING;
