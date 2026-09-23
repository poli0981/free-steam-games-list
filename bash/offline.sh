#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
python scripts/top_offline.py
bash "$(dirname "$0")/commit_push.sh" "Top offline [$(date +'%Y-%m-%d %H:%M')]"
