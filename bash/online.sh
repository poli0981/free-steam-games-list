#!/bin/bash
set -euo pipefail

echo "── Top online leaderboard ──"

pip install --quiet requests jsonlines
python scripts/top_online.py

git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" \
  || (git commit -m "Update top online [$(date +'%Y-%m-%d %H:%M')] by GitHub Action" && git push)
