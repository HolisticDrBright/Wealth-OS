-- DuckDB views over the parquet lake
CREATE OR REPLACE VIEW trades AS
  SELECT * FROM read_parquet('lake/trades/*.parquet');

CREATE OR REPLACE VIEW wallet_stats_60d AS
  SELECT taker AS wallet,
         COUNT(*) AS n_trades,
         AVG(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS win_rate,
         AVG(pnl) / NULLIF(STDDEV(pnl), 0) * SQRT(365) AS sharpe_60d
  FROM trades
  WHERE ts >= now() - INTERVAL 60 DAY
  GROUP BY taker;

CREATE OR REPLACE VIEW category_bias AS
  SELECT category,
         FLOOR(price * 10) / 10 + 0.05 AS price_bucket,
         AVG(resolved_yes::INT) AS realized_freq,
         COUNT(*) AS n
  FROM trades
  GROUP BY category, FLOOR(price * 10) / 10 + 0.05;

CREATE OR REPLACE VIEW hourly_liquidity AS
  SELECT market_type,
         EXTRACT(hour FROM ts) AS utc_hour,
         AVG(spread) AS avg_spread,
         AVG(depth_usd) AS depth
  FROM trades
  GROUP BY market_type, EXTRACT(hour FROM ts);
