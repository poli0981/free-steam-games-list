#!/bin/bash
set -euo pipefail

echo "── Purge unhealthy games ──"

pip install --quiet requests jsonlines
python scripts/purge_unhealthy.py

# Re-generate tables after removal
python scripts/generate_tables.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Purge unhealthy games [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
