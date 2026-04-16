#!/usr/bin/env python3
"""One-time migration: scripts/data.jsonl → data/ sharded format."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import LEGACY_JSONL, DATA_DIR
from core.data_store import load_jsonl, save_main, _shard_paths


def main():
    if not os.path.isfile(LEGACY_JSONL):
        print(f"Legacy file not found: {LEGACY_JSONL}")
        sys.exit(1)

    records = load_jsonl(LEGACY_JSONL)
    if not records:
        print("Empty file, nothing to migrate.")
        return

    print(f"Loaded {len(records)} records from {LEGACY_JSONL}")
    save_main(records)

    shards = _shard_paths()
    print(f"Written to {len(shards)} shard(s) in {DATA_DIR}/:")
    for s in shards:
        count = len(load_jsonl(s))
        print(f"  {s} ({count} records)")

    backup = LEGACY_JSONL + ".pre_shard"
    os.rename(LEGACY_JSONL, backup)
    print(f"\nRenamed {LEGACY_JSONL} -> {backup}")
    print("Migration complete.")


if __name__ == "__main__":
    main()
