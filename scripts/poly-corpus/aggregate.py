#!/usr/bin/env python3
"""Nightly aggregates: DuckDB → Supabase (wallet_stats, category_bias,
hourly_liquidity). Only aggregates leave the lake — never raw trades.

Usage: python aggregate.py --lake ./lake --supabase-url URL --service-key KEY
Requires: pip install duckdb requests
"""
import argparse, pathlib, datetime
import duckdb, requests

def upsert(url, key, table, rows, conflict):
    if not rows:
        return
    r = requests.post(
        f'{url}/rest/v1/{table}?on_conflict={conflict}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}',
                 'Content-Type': 'application/json',
                 'Prefer': 'resolution=merge-duplicates'},
        json=rows, timeout=60)
    r.raise_for_status()
    print(f'{table}: upserted {len(rows)}')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lake', required=True)
    ap.add_argument('--supabase-url', required=True)
    ap.add_argument('--service-key', required=True)
    args = ap.parse_args()
    db = duckdb.connect(str(pathlib.Path(args.lake) / 'corpus.duckdb'))
    now = datetime.datetime.utcnow().isoformat()

    wallets = [{'wallet': w, 'sharpe_60d': s, 'win_rate_30d': wr,
                'calibration_brier': None, 'n_trades': n,
                'recertified_at': now, 'updated_at': now}
               for w, n, wr, s in db.execute(
                   'SELECT wallet, n_trades, win_rate, sharpe_60d FROM wallet_stats_60d WHERE n_trades >= 30'
               ).fetchall()]
    upsert(args.supabase_url, args.service_key, 'wallet_stats', wallets, 'wallet')

    bias = [{'category': c, 'price_bucket': b, 'realized_freq': f, 'n': n, 'updated_at': now}
            for c, b, f, n in db.execute('SELECT * FROM category_bias WHERE n >= 100').fetchall()]
    upsert(args.supabase_url, args.service_key, 'category_bias', bias, 'category,price_bucket')

    liq = [{'market_type': m, 'utc_hour': int(h), 'avg_spread': s, 'depth': d, 'updated_at': now}
           for m, h, s, d in db.execute('SELECT * FROM hourly_liquidity').fetchall()]
    upsert(args.supabase_url, args.service_key, 'hourly_liquidity', liq, 'market_type,utc_hour')

if __name__ == '__main__':
    main()
