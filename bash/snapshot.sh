#!/bin/bash
set -euo pipefail
# No pip install: snapshot.py and scripts/core/* are stdlib-only.
python scripts/snapshot.py
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add data/snapshots/ && git diff --staged --quiet && echo "No changes" || (git commit -m "Snapshot [$(date +'%Y-%m-%d')]" && git push)
