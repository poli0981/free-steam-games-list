#!/bin/bash
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
# PURGE_DRY_RUN is the manual run's "dry run" box: screen and confirm, remove nothing.
# A guard that trips (too many flagged or confirmed) exits non-zero before
# anything is written, so set -e stops here and nothing is committed.
if [[ "${PURGE_DRY_RUN:-}" == "true" ]]; then
  python scripts/purge_unhealthy.py --dry-run
  exit 0
fi
python scripts/purge_unhealthy.py
bash "$(dirname "$0")/commit_push.sh" "Purge unhealthy [$(date +'%Y-%m-%d')]"
