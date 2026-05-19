#!/usr/bin/env python3
"""One-shot CLI: dedup scripts/removed_games.jsonl by appid.

The historic log was append-only without a dedup check, so any game that
got purged → re-added → re-purged accumulated multiple rows. This script
runs `dedup_removed` once over the existing file to compact it. Keeps the
latest entry per appid (by `removed_at`).

Idempotent — re-running on an already-deduped file is a no-op.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import REMOVED_JSONL
from core.data_store import load_jsonl, save_jsonl, dedup_removed


def main():
    records = load_jsonl(REMOVED_JSONL)
    before = len(records)
    deduped = dedup_removed(records)
    after = len(deduped)
    save_jsonl(REMOVED_JSONL, deduped)
    print(f"Records: {before} -> {after} (dropped {before - after})")


if __name__ == "__main__":
    main()
