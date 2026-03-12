#!/bin/bash
set -euo pipefail

echo "── Generate markdown tables ──"

pip install --quiet jsonlines
python scripts/generate_tables.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Auto update tables [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
