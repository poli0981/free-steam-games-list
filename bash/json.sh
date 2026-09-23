#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
python scripts/update_data.py
bash "$(dirname "$0")/commit_push.sh" "Auto update [$(date +'%Y-%m-%d')]"
