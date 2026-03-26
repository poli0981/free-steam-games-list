#!/usr/bin/env python3
"""Export data.jsonl → data.csv"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pandas as pd
from core.constants import DATA_JSONL

def main():
    if not os.path.isfile(DATA_JSONL): print(f"Not found: {DATA_JSONL}"); sys.exit(1)
    df = pd.read_json(DATA_JSONL, lines=True)
    df.to_csv("data.csv", index=False)
    print(f"✓ Exported {len(df)} rows")

if __name__ == "__main__": main()
