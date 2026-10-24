#!/bin/bash
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
# REVIEWS_DRY_RUN is the manual run's "dry run" box: read Steam, write nothing.
if [[ "${REVIEWS_DRY_RUN:-}" == "true" ]]; then
  python scripts/update_reviews.py --dry-run
  exit 0
fi
python scripts/update_reviews.py
bash "$(dirname "$0")/commit_push.sh" "Update reviews [$(date +'%Y-%m-%d')]"
