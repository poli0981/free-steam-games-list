#!/bin/bash
set -euo pipefail
# No pip install: snapshot.py and scripts/core/* are stdlib-only.
python scripts/snapshot.py
bash "$(dirname "$0")/commit_push.sh" "Snapshot [$(date +'%Y-%m-%d')]" data/snapshots/
