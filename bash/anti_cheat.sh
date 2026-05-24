#!/bin/bash
set -euo pipefail
pip install --quiet requests
python scripts/generate_anti_cheat_list.py
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add . && git diff --staged --quiet && echo "No changes" || (git commit -m "Anti-cheat list [$(date +'%Y-%m-%d %H:%M')]" && git push)
