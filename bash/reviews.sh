#!/bin/bash
set -euo pipefail

echo "── Reviews update ──"

pip install --quiet requests jsonlines
python scripts/update_reviews.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Auto update reviews [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
