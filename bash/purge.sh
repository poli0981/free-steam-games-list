#!/bin/bash
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
python scripts/purge_unhealthy.py
bash "$(dirname "$0")/commit_push.sh" "Purge unhealthy [$(date +'%Y-%m-%d')]"
