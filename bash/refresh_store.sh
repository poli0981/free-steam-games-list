#!/bin/bash
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
# REFRESH_ONLY from a manual run: "page" or "details" runs that group of the
# store refresh, "anticheat" only the anti-cheat sweep; empty = everything.
# Each part commits on its own, so a failure in the sweep never costs the
# store refresh its push (and set -e still stops at a crash in either).
if [[ "${REFRESH_ONLY:-}" != "anticheat" ]]; then
  python scripts/refresh_store_data.py ${REFRESH_ONLY:+--only "$REFRESH_ONLY"}
  bash "$(dirname "$0")/commit_push.sh" "Refresh store data [$(date +'%Y-%m-%d')]"
fi
if [[ -z "${REFRESH_ONLY:-}" || "${REFRESH_ONLY:-}" == "anticheat" ]]; then
  python scripts/refresh_anticheat.py
  bash "$(dirname "$0")/commit_push.sh" "Refresh anti-cheat [$(date +'%Y-%m-%d')]"
fi
