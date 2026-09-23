#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
# REFRESH_ONLY: "page" or "details" from a manual run; empty = both groups.
python scripts/refresh_store_data.py ${REFRESH_ONLY:+--only "$REFRESH_ONLY"}
bash "$(dirname "$0")/commit_push.sh" "Refresh store data [$(date +'%Y-%m-%d')]"
