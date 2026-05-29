-- ============================================================
-- Wealth OS — Strategy Hardening Migration
-- Adds maturity gates, paper/live enabled flags, and seeds
-- maturity_status for all 80 known strategies.
-- Safe to re-run (idempotent via IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- ─── 1. Add columns to strategy_definitions ──────────────────────────────────

ALTER TABLE public.strategy_definitions
  ADD COLUMN IF NOT EXISTS maturity_status       text NOT NULL DEFAULT 'paper_trading',
  ADD COLUMN IF NOT EXISTS default_paper_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_live_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_name          text;

-- source_doc was added by 20260509_weekly_review_strategies.sql; guard it
ALTER TABLE public.strategy_definitions
  ADD COLUMN IF NOT EXISTS source_doc text;

-- ─── 2. Add live_enabled to user_enabled_strategies ──────────────────────────

ALTER TABLE public.user_enabled_strategies
  ADD COLUMN IF NOT EXISTS paper_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_enabled  boolean NOT NULL DEFAULT false;

-- ─── 3. Fix enabled/is_enabled duplicate ─────────────────────────────────────
-- If the bad migration added an "enabled" column, reconcile it then drop it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_enabled_strategies'
      AND column_name  = 'enabled'
  ) THEN
    -- Copy non-null enabled values into is_enabled where is_enabled hasn't been set
    UPDATE public.user_enabled_strategies
      SET is_enabled = enabled
      WHERE enabled IS NOT NULL AND is_enabled IS NULL;

    -- Drop the duplicate column
    ALTER TABLE public.user_enabled_strategies DROP COLUMN enabled;
  END IF;
END$$;

-- ─── 4. Seed maturity_status for all 80 strategies ───────────────────────────
-- Uses layman_name as a display_name fallback where display_name is NULL.
-- paper_trading strategies ────────────────────────────────────────────────────

UPDATE public.strategy_definitions SET maturity_status = 'paper_trading'
WHERE strategy_key IN (
  'vcp_minervini', 'quant_momentum', 'qvm_multifactor', 'dividend_aristocrat',
  'options_wheel', 'funding_basis_arb', 'ict_smc', 'session_breakout',
  'fx_trendfollowing', 'triangular_arb', 'correlation_divergence',
  'memecoin_bondingcurve', 'polymarket_resolution_rules', 'polymarket_base_rate',
  'polymarket_info_lag', 'polymarket_cross_market', 'polymarket_event_compression',
  'polymarket_narrative_fade', 'polymarket_liquidity_pocket', 'polymarket_no_trade',
  'polymarket_wallet_copy', 'polymarket_crypto_binary_5min', 'macro_news_event',
  'cb_divergence', 'narrative_rotation', 'merger_arb', 'tail_risk_hedging', 'pead',
  'sector_rotation', 'spinoff', 'dca_halving', 'defi_yield', 'onchain_signal',
  'liquidation_hunting', 'airdrop_farming', 'carry_trade', 'cot_positioning',
  'gamma_exposure', 'autopilot_congressional', 'cex_latency_arb',
  'polymarket_market_maker', 'polymarket_kalshi_weather'
);

-- backtest_ready strategies ────────────────────────────────────────────────────

UPDATE public.strategy_definitions SET maturity_status = 'backtest_ready'
WHERE strategy_key IN (
  'activist_13d_insider_cluster', 'buyback_announcement_momentum', 'etf_basis_arb',
  'lst_basis_arb', 'rwa_yield_stack', 'london_4pm_fix_endmonth', 'swap_point_arbitrage',
  'prediction_market_sportsbook_arb', 'polymarket_triangle_arb', 'pead_microcap_text',
  'vix_term_structure', 'funding_basis_arb_hyperliquid', 'pendle_pt_fixed_yield',
  'month_end_fix', 'jpy_intervention_fade', 'cross_platform_sports_arb',
  'polymarket_theta_decay'
);

-- stub strategies ──────────────────────────────────────────────────────────────

UPDATE public.strategy_definitions SET
  maturity_status       = 'stub',
  default_paper_enabled = false,
  default_live_enabled  = false
WHERE strategy_key IN (
  'odte_strangle_hedged', 'ibit_vol_skew', 'factor_crowded_trade_fade'
);

-- ─── 5. Upsert strategy_definitions rows for any strategies missing them ─────
-- This covers strategies registered only in strategy-registry.ts but not yet
-- in the SQL catalog. Uses minimal required fields; layman_name defaults to key.

INSERT INTO public.strategy_definitions
  (strategy_key, layman_name, plain_english_description, enabled_in_profiles,
   asset_class, requires_advanced_warning, maturity_status,
   default_paper_enabled, default_live_enabled)
VALUES
  ('vcp_minervini',                  'VCP Breakout',               'Minervini VCP pattern', ARRAY['growth','speculative'],   'stocks',      false, 'paper_trading',  false, false),
  ('quant_momentum',                 'Momentum Stock Screen',       'Quantitative momentum', ARRAY['balanced','growth','speculative'], 'stocks', false, 'paper_trading', false, false),
  ('qvm_multifactor',                'Quality & Value Screen',      'QVM multifactor',       ARRAY['conservative','balanced','growth','speculative'], 'stocks', false, 'paper_trading', false, false),
  ('dividend_aristocrat',            'Dividend Income',             'Dividend aristocrats',  ARRAY['vault','conservative','balanced','growth','speculative'], 'stocks', false, 'paper_trading', false, false),
  ('options_wheel',                  'Covered Options Income',      'Options wheel',         ARRAY['vault','conservative','balanced','growth','speculative'], 'options', false, 'paper_trading', false, false),
  ('funding_basis_arb',              'Crypto Funding Rate Arb',     'Funding basis arb',     ARRAY['conservative','balanced','growth','speculative'], 'crypto', false, 'paper_trading', false, false),
  ('ict_smc',                        'Smart Money Concepts',        'ICT/SMC forex',         ARRAY['growth','speculative'],   'forex',       false, 'paper_trading',  false, false),
  ('session_breakout',               'Session Open Breakout',       'Session breakout',      ARRAY['growth','speculative'],   'forex',       false, 'paper_trading',  false, false),
  ('fx_trendfollowing',              'FX Trend Rider',              'FX trend following',    ARRAY['balanced','growth','speculative'], 'forex', false, 'paper_trading', false, false),
  ('triangular_arb',                 'Triangle Arbitrage',          'Triangular arb',        ARRAY['speculative'],            'crypto',      true,  'paper_trading',  false, false),
  ('correlation_divergence',         'Correlation Breakdown Trade',  'Correlation divergence', ARRAY['speculative'],           'multi-asset', false, 'paper_trading',  false, false),
  ('memecoin_bondingcurve',          'Meme Coin Launch Sniper',     'Memecoin bonding curve', ARRAY['speculative'],           'crypto',      true,  'paper_trading',  false, false),
  ('polymarket_resolution_rules',    'Resolution Rules Edge',       'Polymarket resolution', ARRAY['growth','speculative'],   'polymarket',  false, 'paper_trading',  false, false),
  ('polymarket_base_rate',           'Base Rate Betting',           'Base rate betting',     ARRAY['growth','speculative'],   'polymarket',  false, 'paper_trading',  false, false),
  ('polymarket_info_lag',            'News Arbitrage',              'Info lag arbitrage',    ARRAY['balanced','growth','speculative'], 'polymarket', false, 'paper_trading', false, false),
  ('polymarket_cross_market',        'Cross-Market Arb',            'Cross market arb',      ARRAY['growth','speculative'],   'polymarket',  false, 'paper_trading',  false, false),
  ('polymarket_event_compression',   'Event Compression',           'Event compression',     ARRAY['growth','speculative'],   'polymarket',  false, 'paper_trading',  false, false),
  ('polymarket_narrative_fade',      'Narrative Fade',              'Narrative fade',        ARRAY['speculative'],            'polymarket',  false, 'paper_trading',  false, false),
  ('polymarket_liquidity_pocket',    'Liquidity Pocket Sniper',     'Liquidity pocket',      ARRAY['speculative'],            'polymarket',  false, 'paper_trading',  false, false),
  ('polymarket_no_trade',            'No-Trade Signal',             'No trade signal',       ARRAY['balanced','growth','speculative'], 'polymarket', false, 'paper_trading', false, false),
  ('polymarket_wallet_copy',         'Smart Bettor Follow',         'Wallet copy',           ARRAY['balanced','growth','speculative'], 'polymarket', false, 'paper_trading', false, false),
  ('polymarket_crypto_binary_5min',  'Crypto 5-Minute Binary',      'Crypto binary 5min',    ARRAY['growth','speculative'],   'polymarket',  false, 'paper_trading',  false, false),
  ('macro_news_event',               'Macro Event Trader',          'Macro news event',      ARRAY['growth','speculative'],   'multi-asset', false, 'paper_trading',  false, false),
  ('cb_divergence',                  'Central Bank Divergence',     'CB divergence',         ARRAY['growth','speculative'],   'forex',       false, 'paper_trading',  false, false),
  ('narrative_rotation',             'Crypto Narrative Surf',       'Narrative rotation',    ARRAY['balanced','growth','speculative'], 'crypto', false, 'paper_trading', false, false),
  ('merger_arb',                     'Merger Arbitrage',            'Merger arb',            ARRAY['speculative'],            'stocks',      false, 'paper_trading',  false, false),
  ('tail_risk_hedging',              'Tail Risk Hedge',             'Tail risk hedging',     ARRAY['speculative'],            'options',     false, 'paper_trading',  false, false),
  ('pead',                           'Earnings Drift Capture',      'PEAD',                  ARRAY['balanced','growth','speculative'], 'stocks', false, 'paper_trading', false, false),
  ('sector_rotation',                'Sector Momentum Shift',       'Sector rotation',       ARRAY['conservative','balanced','growth','speculative'], 'stocks', false, 'paper_trading', false, false),
  ('spinoff',                        'Spinoff Event Capture',       'Spinoff',               ARRAY['speculative'],            'stocks',      false, 'paper_trading',  false, false),
  ('dca_halving',                    'Bitcoin Cycle Buy',           'DCA halving',           ARRAY['vault','conservative','balanced','growth','speculative'], 'crypto', false, 'paper_trading', false, false),
  ('defi_yield',                     'DeFi Yield Farming',          'DeFi yield',            ARRAY['vault','conservative','balanced','growth','speculative'], 'crypto', false, 'paper_trading', false, false),
  ('onchain_signal',                 'On-Chain Smart Money',        'On-chain signal',       ARRAY['balanced','growth','speculative'], 'crypto', false, 'paper_trading', false, false),
  ('liquidation_hunting',            'Liquidation Cascade',         'Liquidation hunting',   ARRAY['growth','speculative'],   'crypto',      false, 'paper_trading',  false, false),
  ('airdrop_farming',                'Airdrop Farming',             'Airdrop farming',       ARRAY['speculative'],            'crypto',      false, 'paper_trading',  false, false),
  ('carry_trade',                    'Currency Carry',              'Carry trade',           ARRAY['conservative','balanced','growth','speculative'], 'forex', false, 'paper_trading', false, false),
  ('cot_positioning',                'Institutional Flow Tracker',  'COT positioning',       ARRAY['conservative','balanced','growth','speculative'], 'multi-asset', false, 'paper_trading', false, false),
  ('gamma_exposure',                 'Gamma Exposure Trade',        'Gamma exposure',        ARRAY['speculative'],            'options',     true,  'paper_trading',  false, false),
  ('autopilot_congressional',        'Congressional Trade Follow',  'Congressional autopilot', ARRAY['growth','speculative'], 'stocks',      false, 'paper_trading',  false, false),
  ('cex_latency_arb',                'Exchange Speed Arb',          'CEX latency arb',       ARRAY['speculative'],            'crypto',      true,  'paper_trading',  false, false),
  ('polymarket_market_maker',        'Prediction Market Making',    'Market maker',          ARRAY['speculative'],            'polymarket',  true,  'paper_trading',  false, false),
  ('polymarket_kalshi_weather',      'Weather Prediction Markets',  'Kalshi weather arb',    ARRAY['growth','speculative'],   'polymarket',  false, 'paper_trading',  false, false),
  -- backtest_ready
  ('activist_13d_insider_cluster',   'Activist & Insider Cluster',  'Activist 13D',          ARRAY['growth','speculative'],   'stocks',      false, 'backtest_ready', false, false),
  ('buyback_announcement_momentum',  'Buyback Momentum',            'Buyback announcement',  ARRAY['balanced','growth','speculative'], 'stocks', false, 'backtest_ready', false, false),
  ('etf_basis_arb',                  'ETF Fair-Value Trade',        'ETF basis arb',         ARRAY['vault','conservative','balanced','growth','speculative'], 'multi-asset', false, 'backtest_ready', false, false),
  ('lst_basis_arb',                  'Liquid Staking Basis',        'LST basis arb',         ARRAY['conservative','balanced','growth','speculative'], 'crypto', false, 'backtest_ready', false, false),
  ('rwa_yield_stack',                'Real-World Asset Yield',      'RWA yield stack',       ARRAY['vault','conservative','balanced','growth','speculative'], 'crypto', false, 'backtest_ready', false, false),
  ('london_4pm_fix_endmonth',        'Month-End FX Fix',            'London 4pm fix',        ARRAY['balanced','growth','speculative'], 'forex', false, 'backtest_ready', false, false),
  ('swap_point_arbitrage',           'FX Swap Point Arb',           'Swap point arb',        ARRAY['speculative'],            'forex',       true,  'backtest_ready', false, false),
  ('prediction_market_sportsbook_arb','Sportsbook vs Prediction Market','Sportsbook arb',    ARRAY['speculative'],            'polymarket',  true,  'backtest_ready', false, false),
  ('polymarket_triangle_arb',        'Prediction Market Triangle Arb','Triangle arb',        ARRAY['speculative'],            'polymarket',  false, 'backtest_ready', false, false),
  ('pead_microcap_text',             'PEAD Microcap Text',          'PEAD microcap',         ARRAY['growth','speculative'],   'stocks',      false, 'backtest_ready', false, false),
  ('vix_term_structure',             'VIX Term Structure',          'VIX term structure',    ARRAY['balanced','growth'],      'options',     true,  'backtest_ready', false, false),
  ('funding_basis_arb_hyperliquid',  'Funding Basis Arb (Hyperliquid)','Hyperliquid funding', ARRAY['conservative','balanced','growth','speculative'], 'crypto', false, 'backtest_ready', false, false),
  ('pendle_pt_fixed_yield',          'Pendle PT Fixed Yield',       'Pendle PT yield',       ARRAY['vault','conservative','balanced','growth'], 'crypto', false, 'backtest_ready', false, false),
  ('month_end_fix',                  'Month-End Fix',               'Month end fix',         ARRAY['vault','conservative','balanced','growth','speculative'], 'forex', false, 'backtest_ready', false, false),
  ('jpy_intervention_fade',          'JPY Intervention Fade',       'JPY fade',              ARRAY['balanced','growth','speculative'], 'forex', false, 'backtest_ready', false, false),
  ('cross_platform_sports_arb',      'Cross-Platform Sports Arb',   'Sports arb',            ARRAY['vault','conservative','balanced','growth','speculative'], 'polymarket', false, 'backtest_ready', false, false),
  ('polymarket_theta_decay',         'Polymarket Theta Decay',      'Theta decay',           ARRAY['balanced','growth','speculative'], 'polymarket', false, 'backtest_ready', false, false),
  -- stub
  ('odte_strangle_hedged',           '0DTE Strangle Hedged',        'ODTE strangle stub',    ARRAY['growth','speculative'],   'options',     false, 'stub',           false, false),
  ('ibit_vol_skew',                  'IBIT Vol Skew',               'IBIT vol skew stub',    ARRAY['balanced','growth','speculative'], 'options', false, 'stub',      false, false),
  ('factor_crowded_trade_fade',      'Factor Crowded Trade Fade',   'Factor fade stub',      ARRAY['balanced','growth','speculative'], 'stocks', false, 'stub',       false, false)
ON CONFLICT (strategy_key) DO UPDATE
  SET maturity_status       = EXCLUDED.maturity_status,
      default_paper_enabled = EXCLUDED.default_paper_enabled,
      default_live_enabled  = EXCLUDED.default_live_enabled;

-- ─── 6. Safety constraint: stub strategies must have paper+live disabled ──────

UPDATE public.strategy_definitions
  SET default_paper_enabled = false,
      default_live_enabled  = false
  WHERE maturity_status = 'stub';
