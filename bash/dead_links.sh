#!/bin/bash
set -euo pipefail

echo "── Dead link check ──"

pip install --quiet requests jsonlines
python scripts/check_dead_links.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Dead link check [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
