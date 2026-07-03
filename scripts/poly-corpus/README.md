# Polymarket Historical Corpus (Gap brief A2)

Bulk trade data lives OUTSIDE Supabase: a local/VPS **parquet lake + DuckDB**,
with only nightly aggregates promoted to Supabase (`wallet_stats`,
`category_bias`, `hourly_liquidity` — migration `20260703g`).

## Disk requirement
The SII-WANGZJ historical bulk load is **107GB+**. Provision accordingly
(VPS block storage). The warproxxx/poly_data retriever path is incremental
and much smaller.

## Pipeline
1. `python ingest.py --source warproxxx --out lake/` — Goldsky `OrderFilled`
   events → trades.csv → parquet partitioned by month (`lake/trades/YYYY-MM.parquet`).
   Resumable: existing partitions are skipped; pass `--force-month YYYY-MM` to rebuild one.
2. `python ingest.py --source sii-wangzj --archive /path/to/dump --out lake/`
   — optional 107GB bulk load, chunked + resumable via `lake/.progress.json`.
3. `duckdb lake/corpus.duckdb < views.sql` — views over the partitions.
4. `python aggregate.py --lake lake/ --supabase-url ... --service-key ...`
   — nightly job: computes wallet_stats (60d Sharpe, 30d win rate, Brier,
   n_trades, recertified_at), category_bias (realized frequency per price
   bucket per category — the longshot-bias measurement the KB requires
   before any bias strategy trades), hourly_liquidity (Wolf Hour validation),
   and upserts them to Supabase.

## Consumers
- `polymarket_wallet_copy` reads the copied wallet's REAL rolling stats from
  `wallet_stats` (60d-Sharpe admission + 30d recertification, the Smart Money
  Basket standard); estimates are only the cold-start fallback.
- `empirical-kelly` Polymarket priors come from `category_bias`.

## Fixture
`__tests__/fixtures/poly-corpus-sample.json` holds one sample month of
aggregate output shape, used by tests.
