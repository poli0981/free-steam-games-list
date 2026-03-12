#!/bin/bash
set -euo pipefail

echo "── Full data update ──"

pip install --quiet requests jsonlines
python scripts/update_data.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Auto update data [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
