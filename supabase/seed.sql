-- ─── Wealth OS Seed Data ──────────────────────────────────────────────────
-- Run this in your Supabase SQL editor AFTER running schema.sql
-- Inserts 20 demo traders, 40 demo trades, 5 simulations, sample alerts & opportunities
-- All inserts are idempotent (ON CONFLICT DO NOTHING based on handle)

-- ─── 20 Demo Traders ──────────────────────────────────────────────────────
INSERT INTO public.traders (handle, name, asset_class, source, bio, total_return_pct, ytd_return_pct, win_rate_pct, avg_trade_size_usd, trade_count, followers_count, verified, is_active, metadata)
VALUES
  -- Stocks (Unusual Whales / Quiver Quant)
  ('nancypelosi',   'Nancy Pelosi',       'stock',      'quiver_quant',     'US Congress member. Consistently outperforms market. Tech & semiconductor focus.',                    28.4,  14.2, 73, 250000,   18,  4820, true,  true, '{}'),
  ('cathiewood',    'Cathie Wood',        'stock',      'unusual_whales',   'ARK Invest founder. Disruptive innovation, genomics, fintech, AI.',                                  42.1,  22.8, 61, 12000000, 134,  9341, true,  true, '{}'),
  ('michaelburry',  'Michael Burry',      'stock',      'quiver_quant',     'Scion Asset Management. Contrarian macro bets. Famous for Big Short.',                               -4.8,   8.1, 55,  800000,  12,  6102, true,  true, '{}'),
  ('deepvaluedave', 'DeepValue Dave',     'stock',      'unusual_whales',   'Unusual options flow specialist. Tracks large institutional sweeps.',                                 67.3,  31.5, 71,   85000,  89,  2241, false, true, '{}'),
  ('pelosi_tracker','Pelosi Tracker Bot', 'stock',      'quiver_quant',     'Automated tracker for congressional trades. Mirrors Pelosi portfolio moves within 24h.',             31.2,  16.8, 69,   45000,  22,  3102, false, true, '{}'),
  ('jpmorgan_flow', 'JP Morgan Flow',     'stock',      'unusual_whales',   'Tracks JPMorgan institutional order flow. Focuses on large-cap momentum.',                           18.7,  11.3, 64, 5000000,  56,  1803, false, true, '{}'),
  ('berkshireclone','Berkshire Clone',    'stock',      'quiver_quant',     'Mirrors Berkshire Hathaway 13F filings. Value investing, long hold periods.',                        14.2,   9.1, 78, 2500000,  8,   4417, false, true, '{}'),
  ('techwhale2024', 'Tech Whale 2024',    'stock',      'unusual_whales',   'Large options buyer in NVDA, TSLA, AAPL. Earnings play specialist.',                                 88.4,  44.1, 58,  320000,  47,  5519, false, true, '{}'),

  -- Crypto (Nansen / Arkham)
  ('whalealert',    'Whale Alert',        'crypto',     'nansen',           'On-chain large transaction tracker. Follows smart money wallets on Ethereum and Solana.',            124.5,  67.3, 66,  850000,  203, 12041, true,  true, '{}'),
  ('3ac_phoenix',   '3AC Phoenix',        'crypto',     'arkham',           'Reformed DeFi fund. Multi-chain yield and momentum strategies post-2022 lessons.',                   45.8,  28.9, 59,  175000,  88,  3304, false, true, '{}'),
  ('solanaseason',  'Solana Season',      'crypto',     'nansen',           'SOL ecosystem specialist. Tracks Solana DeFi, NFTs, and new protocol launches.',                    312.4, 145.7, 63,   42000,  156,  6728, false, true, '{}'),
  ('btcmaxi_alpha', 'BTC Maxi Alpha',     'crypto',     'arkham',           'Bitcoin-only strategy. Spot accumulation on dips, partial sells at ATH zones.',                      52.1,  31.4, 71,  620000,  34,  8891, false, true, '{}'),
  ('defi_degen',    'DeFi Degen',         'crypto',     'nansen',           'High-risk/high-reward DeFi plays. LP positions, yield farms, and token launches.',                  445.2, 198.3, 44,   18000,  412,  2203, false, true, '{}'),

  -- Forex (MyFXBook)
  ('fxpro_london',  'FX Pro London',      'forex',      'myfxbook',         'London session forex scalper. EUR/USD, GBP/USD with tight stops.',                                   22.3,  13.1, 68,   25000,  891,  1042, true,  true, '{}'),
  ('pipmaster',     'Pip Master',         'forex',      'myfxbook',         'Swing trader. Focuses on major pairs during New York-London overlap.',                               38.7,  19.4, 72,   18000,  234,   887, false, true, '{}'),
  ('carry_trade_g', 'Carry Trade Guild',  'forex',      'myfxbook',         'Exploits interest rate differentials. Long high-yield, short low-yield currencies.',                 15.9,   8.7, 81,   95000,  67,   564, false, true, '{}'),

  -- Polymarket (prediction markets)
  ('poly_alpha',    'Poly Alpha',         'polymarket', 'polymarket',       'Prediction market specialist. Trades on election, sports, macro, and regulatory outcomes.',           89.3,  52.1, 74,    8500,  344,  3341, true,  true, '{}'),
  ('electionbets',  'Election Bets Pro',  'polymarket', 'polymarket',       'US politics and election market specialist. Long track record on electoral outcomes.',               143.7,  78.2, 69,   12000,  156,  2209, false, true, '{}'),
  ('macro_oracle',  'Macro Oracle',       'polymarket', 'polymarket',       'Trades Fed decisions, CPI prints, and macro event markets on Polymarket.',                           67.4,  38.9, 77,   22000,  89,   1678, false, true, '{}'),
  ('sportsbetpro',  'Sports Bet Pro',     'polymarket', 'polymarket',       'Sports outcome markets. NFL, NBA, and soccer. Statistical edge from model-based pricing.',            55.8,  29.3, 71,    5500,  502,  1102, false, true, '{}')
ON CONFLICT (handle) DO NOTHING;

-- ─── 40 Demo Trades (2 per trader) ────────────────────────────────────────
-- We reference traders by handle using a subquery to stay handle-agnostic re: UUID
INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'NVDA', 'buy', 500, 875.40, 437700, NOW() - INTERVAL '1 day', '{}'
FROM public.traders WHERE handle = 'nancypelosi' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'MSFT', 'buy', 1000, 415.20, 415200, NOW() - INTERVAL '3 days', '{}'
FROM public.traders WHERE handle = 'nancypelosi' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'TSLA', 'buy', 200, 242.80, 48560, NOW() - INTERVAL '2 days', '{}'
FROM public.traders WHERE handle = 'cathiewood' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'ARKK', 'buy', 50000, 48.30, 2415000, NOW() - INTERVAL '5 days', '{}'
FROM public.traders WHERE handle = 'cathiewood' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'BABA', 'buy', 10000, 78.40, 784000, NOW() - INTERVAL '4 days', '{}'
FROM public.traders WHERE handle = 'michaelburry' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'GEO', 'sell', 5000, 23.10, 115500, NOW() - INTERVAL '7 days', '{}'
FROM public.traders WHERE handle = 'michaelburry' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'SPY', 'buy', 2000, 528.40, 1056800, NOW() - INTERVAL '1 day', '{}'
FROM public.traders WHERE handle = 'deepvaluedave' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'QQQ', 'buy', 1500, 462.30, 693450, NOW() - INTERVAL '6 hours', '{}'
FROM public.traders WHERE handle = 'deepvaluedave' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'AMZN', 'buy', 300, 198.70, 59610, NOW() - INTERVAL '8 hours', '{}'
FROM public.traders WHERE handle = 'pelosi_tracker' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'GOOGL', 'buy', 400, 178.20, 71280, NOW() - INTERVAL '2 days', '{}'
FROM public.traders WHERE handle = 'pelosi_tracker' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'JPM', 'buy', 5000, 222.40, 1112000, NOW() - INTERVAL '3 days', '{}'
FROM public.traders WHERE handle = 'jpmorgan_flow' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'GS', 'sell', 2000, 512.80, 1025600, NOW() - INTERVAL '9 days', '{}'
FROM public.traders WHERE handle = 'jpmorgan_flow' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'BRK.B', 'buy', 10000, 414.50, 4145000, NOW() - INTERVAL '30 days', '{}'
FROM public.traders WHERE handle = 'berkshireclone' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'KO', 'buy', 20000, 67.20, 1344000, NOW() - INTERVAL '45 days', '{}'
FROM public.traders WHERE handle = 'berkshireclone' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'NVDA', 'buy', 1000, 875.00, 875000, NOW() - INTERVAL '12 hours', '{}'
FROM public.traders WHERE handle = 'techwhale2024' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'stock', 'TSLA', 'buy', 500, 245.60, 122800, NOW() - INTERVAL '2 days', '{}'
FROM public.traders WHERE handle = 'techwhale2024' ON CONFLICT DO NOTHING;

-- Crypto trades
INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'ETH', 'buy', 1000, 3412.50, 3412500, NOW() - INTERVAL '6 hours', '{}'
FROM public.traders WHERE handle = 'whalealert' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'BTC', 'buy', 50, 87420.00, 4371000, NOW() - INTERVAL '1 day', '{}'
FROM public.traders WHERE handle = 'whalealert' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'SOL', 'buy', 5000, 178.40, 892000, NOW() - INTERVAL '3 days', '{}'
FROM public.traders WHERE handle = '3ac_phoenix' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'AVAX', 'buy', 10000, 38.70, 387000, NOW() - INTERVAL '5 days', '{}'
FROM public.traders WHERE handle = '3ac_phoenix' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'SOL', 'buy', 20000, 178.20, 3564000, NOW() - INTERVAL '4 hours', '{}'
FROM public.traders WHERE handle = 'solanaseason' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'JTO', 'buy', 100000, 3.42, 342000, NOW() - INTERVAL '2 days', '{}'
FROM public.traders WHERE handle = 'solanaseason' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'BTC', 'buy', 100, 85000.00, 8500000, NOW() - INTERVAL '10 days', '{}'
FROM public.traders WHERE handle = 'btcmaxi_alpha' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'BTC', 'sell', 30, 91200.00, 2736000, NOW() - INTERVAL '3 days', '{}'
FROM public.traders WHERE handle = 'btcmaxi_alpha' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'DEGEN', 'buy', 5000000, 0.0042, 21000, NOW() - INTERVAL '1 day', '{}'
FROM public.traders WHERE handle = 'defi_degen' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'crypto', 'WIF', 'buy', 200000, 2.87, 574000, NOW() - INTERVAL '5 hours', '{}'
FROM public.traders WHERE handle = 'defi_degen' ON CONFLICT DO NOTHING;

-- Forex trades
INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'forex', 'EURUSD', 'buy', 500000, 1.0842, 542100, NOW() - INTERVAL '2 hours', '{}'
FROM public.traders WHERE handle = 'fxpro_london' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'forex', 'GBPUSD', 'sell', 250000, 1.2634, 315850, NOW() - INTERVAL '8 hours', '{}'
FROM public.traders WHERE handle = 'fxpro_london' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'forex', 'USDJPY', 'buy', 1000000, 153.42, 6514000, NOW() - INTERVAL '1 day', '{}'
FROM public.traders WHERE handle = 'pipmaster' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'forex', 'AUDUSD', 'sell', 300000, 0.6512, 195360, NOW() - INTERVAL '3 days', '{}'
FROM public.traders WHERE handle = 'pipmaster' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'forex', 'NZDUSD', 'buy', 500000, 0.6124, 306200, NOW() - INTERVAL '7 days', '{}'
FROM public.traders WHERE handle = 'carry_trade_g' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'forex', 'USDCHF', 'sell', 200000, 0.8932, 178640, NOW() - INTERVAL '4 days', '{}'
FROM public.traders WHERE handle = 'carry_trade_g' ON CONFLICT DO NOTHING;

-- Polymarket trades
INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'polymarket', 'FED-RATE-CUT-MAR', 'buy', 10000, 0.72, 7200, NOW() - INTERVAL '3 days', '{"market":"Will Fed cut rates in March 2026?"}'
FROM public.traders WHERE handle = 'poly_alpha' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'polymarket', 'TRUMP-2028', 'buy', 5000, 0.38, 1900, NOW() - INTERVAL '6 days', '{"market":"Will Trump run in 2028?"}'
FROM public.traders WHERE handle = 'poly_alpha' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'polymarket', 'BITCOIN-100K-2026', 'buy', 15000, 0.61, 9150, NOW() - INTERVAL '2 days', '{"market":"Will Bitcoin hit $100k in 2026?"}'
FROM public.traders WHERE handle = 'electionbets' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'polymarket', 'CPI-BELOW-3-JAN', 'buy', 8000, 0.55, 4400, NOW() - INTERVAL '1 day', '{"market":"Will CPI be below 3% in Jan 2026?"}'
FROM public.traders WHERE handle = 'macro_oracle' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'polymarket', 'SUPER-BOWL-LX', 'buy', 12000, 0.48, 5760, NOW() - INTERVAL '5 days', '{"market":"Will Chiefs win Super Bowl LX?"}'
FROM public.traders WHERE handle = 'sportsbetpro' ON CONFLICT DO NOTHING;

INSERT INTO public.trader_trades (trader_id, asset_class, symbol, action, quantity, price, notional_value, trade_date, metadata)
SELECT id, 'polymarket', 'NBA-FINALS-2026', 'buy', 6000, 0.33, 1980, NOW() - INTERVAL '4 days', '{"market":"Will Celtics win 2026 NBA Finals?"}'
FROM public.traders WHERE handle = 'sportsbetpro' ON CONFLICT DO NOTHING;

-- ─── 5 Demo Simulation Jobs (completed) ───────────────────────────────────
-- NOTE: These reference no user (user_id = NULL for demo). Run as admin.
-- To attach to a real user, replace NULL with auth.uid() after logging in.

INSERT INTO public.simulation_jobs (title, description, asset_class, symbols, scenario, horizon_days, num_simulations, status, started_at, completed_at)
VALUES
  ('BTC Bull Run Q2 2026',         'Bitcoin bull scenario targeting $120k by Q2',             'crypto', ARRAY['BTC','ETH','SOL'],   'bull',       30,  1000, 'completed', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes'),
  ('Tech Sector Stress Test',      'NVDA/TSLA/AAPL under Fed rate shock scenario',             'stock',  ARRAY['NVDA','TSLA','AAPL'], 'stress',     14,  2000, 'completed', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '3 minutes'),
  ('Forex Base Case H1 2026',      'Major pairs base case for first half of 2026',             'forex',  ARRAY['EURUSD','GBPUSD'],   'base',       60,  1500, 'completed', NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days' + INTERVAL '1 minute'),
  ('Crypto Bear Scenario',         'What if BTC drops 40% — impact across portfolio',          'crypto', ARRAY['BTC','ETH'],          'bear',       30,  1000, 'completed', NOW() - INTERVAL '10 days',NOW() - INTERVAL '10 days' + INTERVAL '2 minutes'),
  ('Monte Carlo Portfolio 1000x',  '1000-run Monte Carlo over full copy trading portfolio',    NULL,     ARRAY[]::text[],             'montecarlo', 90,  1000, 'completed', NOW() - INTERVAL '14 days',NOW() - INTERVAL '14 days' + INTERVAL '4 minutes')
ON CONFLICT DO NOTHING;

-- ─── Sample Opportunities (global, no user) ───────────────────────────────
INSERT INTO public.opportunities (source, symbol, asset_class, title, description, action, confidence, score, is_read, metadata)
VALUES
  ('screener', 'NVDA', 'stock',  'NVDA Momentum Breakout',         'NVDA breaking out of 6-week consolidation with elevated volume. Options flow bullish.',            'buy',   'high',   87, false, '{}'),
  ('screener', 'BTC',  'crypto', 'BTC Re-accumulation Zone',       'Bitcoin holding above $85k support after retest. On-chain accumulation by long-term holders.',      'buy',   'high',   82, false, '{}'),
  ('screener', 'TSLA', 'stock',  'TSLA Oversold Bounce Setup',     'TSLA RSI at 28, approaching key support at $220. High risk/reward for short-term bounce.',          'watch', 'medium', 61, false, '{}'),
  ('screener', 'SOL',  'crypto', 'SOL Ecosystem Momentum',         'Solana DEX volume at ATH. Multiple DePIN projects launching. Technical breakout above $180.',       'buy',   'high',   79, false, '{}'),
  ('screener', 'AAPL', 'stock',  'AAPL AI Services Catalyst',      'Apple Intelligence adoption accelerating. Services revenue beat expected Q2. Entry near 52w low.',  'watch', 'medium', 58, false, '{}')
ON CONFLICT DO NOTHING;

-- ─── End of seed data ─────────────────────────────────────────────────────
