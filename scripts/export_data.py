"""
Export data.jsonl → data.csv
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
from core.constants import DATA_JSONL


def main():
    if not os.path.isfile(DATA_JSONL):
        print(f"File not found: {DATA_JSONL}")
        sys.exit(1)

    df = pd.read_json(DATA_JSONL, lines=True)
    out = "data.csv"
    df.to_csv(out, index=False)
    print(f"✓ Exported {len(df)} rows to {out}")


if __name__ == "__main__":
    main()
