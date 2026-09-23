#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
python scripts/purge_unhealthy.py
bash "$(dirname "$0")/commit_push.sh" "Purge unhealthy [$(date +'%Y-%m-%d')]"
