#!/bin/bash
set -euo pipefail
echo "── Force re-fetch ALL games (v2.1 schema) ──"

pip install --quiet requests jsonlines
python scripts/refetch_all.py

# Regenerate tables with fresh data
python scripts/generate_tables.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes" \
  || (git commit -m "Force re-fetch all games → v2.1 schema [$(date +'%Y-%m-%d')]" && git push)
