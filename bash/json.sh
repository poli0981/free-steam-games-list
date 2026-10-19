#!/bin/bash
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
python scripts/update_data.py
bash "$(dirname "$0")/commit_push.sh" "Auto update [$(date +'%Y-%m-%d')]"
