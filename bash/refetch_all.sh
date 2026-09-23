#!/bin/bash
set -euo pipefail
echo "── Force re-fetch ALL games (v2.1 schema) ──"

pip install --quiet -r requirements.txt
python scripts/refetch_all.py
bash "$(dirname "$0")/commit_push.sh" "Force re-fetch all games → v2.1 schema [$(date +'%Y-%m-%d')]"
