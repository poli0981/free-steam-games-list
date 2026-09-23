#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
python scripts/check_dead_links.py
bash "$(dirname "$0")/commit_push.sh" "Dead link check [$(date +'%Y-%m-%d')]"
