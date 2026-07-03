#!/usr/bin/env python3
"""Convert warproxxx/poly_data CSVs (or SII-WANGZJ chunks) to a monthly
parquet lake. Resumable: existing partitions are skipped.

Usage: python to_parquet.py --src ./data --out ./lake [--force-month YYYY-MM]
Requires: pip install pandas pyarrow
"""
import argparse, json, pathlib
import pandas as pd

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--force-month', default=None)
    args = ap.parse_args()

    out = pathlib.Path(args.out) / 'trades'
    out.mkdir(parents=True, exist_ok=True)
    progress_file = pathlib.Path(args.out) / '.progress.json'
    progress = json.loads(progress_file.read_text()) if progress_file.exists() else {}

    for csv in sorted(pathlib.Path(args.src).glob('**/*.csv')):
        print(f'reading {csv}')
        for chunk in pd.read_csv(csv, chunksize=1_000_000):
            ts_col = next(c for c in ('timestamp', 'ts', 'time') if c in chunk.columns)
            chunk['ts'] = pd.to_datetime(chunk[ts_col], unit='s', errors='coerce')
            chunk = chunk.dropna(subset=['ts'])
            for month, part in chunk.groupby(chunk['ts'].dt.strftime('%Y-%m')):
                dest = out / f'{month}.parquet'
                if dest.exists() and month != args.force_month and progress.get(str(dest)) == 'done':
                    continue
                if dest.exists():
                    part = pd.concat([pd.read_parquet(dest), part]).drop_duplicates()
                part.to_parquet(dest, index=False)
                progress[str(dest)] = 'done'
                progress_file.write_text(json.dumps(progress))
                print(f'  wrote {dest} ({len(part)} rows)')

if __name__ == '__main__':
    main()
