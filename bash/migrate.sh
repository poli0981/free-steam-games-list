#!/bin/bash
set -euo pipefail
pip install --quiet jsonlines
python scripts/migrate_schema.py
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add . && git diff --staged --quiet && echo "No changes" || (git commit -m "Schema v2.1 migrate [$(date +'%Y-%m-%d')]" && git push)
