#!/bin/bash
set -euo pipefail
pip install --quiet -r requirements.txt
# PEAKS_ALL is the manual run's "backfill" box: "true" asks SteamCharts about
# every game (~4 h) instead of today's thirtieth. A scheduled run leaves it
# empty, and an unticked box sends "false" - neither may pass --all.
args=()
if [ "${PEAKS_ALL:-}" = "true" ]; then
  args+=(--all)
fi
python scripts/refresh_peaks.py ${args[@]+"${args[@]}"}
bash "$(dirname "$0")/commit_push.sh" "Refresh all-time peaks [$(date +'%Y-%m-%d')]"
