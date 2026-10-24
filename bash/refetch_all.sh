#!/bin/bash
set -euo pipefail
# REFETCH_PART is the manual run's "part" box, K/N (scripts/refetch_all.py
# checks it): the whole catalogue no longer fits in one job.
part="${REFETCH_PART:-1/1}"
echo "── Force re-fetch, part ${part} ──"

pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
python scripts/refetch_all.py --part "$part"
bash "$(dirname "$0")/commit_push.sh" "Force re-fetch, part ${part} [$(date +'%Y-%m-%d')]"
