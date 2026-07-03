#!/usr/bin/env python3
"""Build DuckDB views over the parquet lake.
Usage: python build_views.py --lake ./lake
Requires: pip install duckdb
"""
import argparse, pathlib
import duckdb

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lake', required=True)
    args = ap.parse_args()
    db = duckdb.connect(str(pathlib.Path(args.lake) / 'corpus.duckdb'))
    sql = (pathlib.Path(__file__).parent / 'views.sql').read_text()
    db.execute(sql.replace('lake/', f'{args.lake}/'))
    print('views built:', [r[0] for r in db.execute("SHOW TABLES").fetchall()])

if __name__ == '__main__':
    main()
