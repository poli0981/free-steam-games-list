#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
python scripts/top_online.py
bash "$(dirname "$0")/commit_push.sh" "Top online [$(date +'%Y-%m-%d %H:%M')]"
