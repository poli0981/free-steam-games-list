#!/bin/bash
set -euo pipefail
pip install --quiet requests jsonlines
python scripts/purge_unhealthy.py
python scripts/generate_tables.py
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add . && git diff --staged --quiet && echo "No changes" || (git commit -m "Purge unhealthy [$(date +'%Y-%m-%d')]" && git push)
