#!/bin/bash
set -euo pipefail

echo "── Ingest new game links ──"

pip install --quiet requests jsonlines
python scripts/ingest_new.py

# Re-generate tables after adding new games
pip install --quiet pandas
python scripts/generate_tables.py

# Git commit
git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Ingest new games [$(date +'%Y-%m-%d %H:%M')] by GitHub Action" && git push)
