#!/bin/bash
# Commit what a data job changed, and push it even if main moved meanwhile.
#
# A data job can run for hours (update-reviews, check-dead-links,
# purge-unhealthy), and `concurrency: data-write` serialises only the
# WORKFLOWS. main still moves underneath one: a merged pull request, an /admin
# approval or override the Worker commits, the extension's push to
# scripts/temp_info.jsonl. A plain `git push` is then rejected ("fetch first")
# and the whole run is thrown away - purge-unhealthy lost four hours of work
# that way on 2026-09-21.
#
# None of those other writers touch the shards, so rebasing onto them and
# pushing again is safe. A genuine conflict still fails the job, loudly.
#
# Usage: commit_push.sh "<commit message>" [pathspec ...]    (default: .)
set -euo pipefail

msg="$1"
shift
if [ "$#" -eq 0 ]; then
  set -- .
fi

git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'

git add -- "$@"
if git diff --staged --quiet; then
  echo "No changes"
  exit 0
fi
git commit -m "$msg"

for attempt in 1 2 3 4 5; do
  if git push; then
    exit 0
  fi
  echo "Push rejected (attempt $attempt/5): rebasing onto origin/main and retrying"
  sleep $((attempt * 10))
  git pull --rebase origin main
done

echo "::error::push still rejected after 5 attempts"
exit 1
