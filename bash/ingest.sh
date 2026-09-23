#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
python scripts/ingest_new.py
bash "$(dirname "$0")/commit_push.sh" "Ingest games [$(date +'%Y-%m-%d %H:%M')]"
