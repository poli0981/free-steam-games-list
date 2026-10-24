#!/bin/bash
# The ingest job, which is also the removal job.
#
# remove_games.py applies data/blocklist.jsonl (games the maintainer removed in
# /admin or with delete_game.py) before ingest_new.py adds the queued links.
# One workflow does both: a commit to either file starts one run that settles
# the two, in that order. (It was also the only way to do it while
# `data-write` kept a single pending run and a separate removal workflow and
# the ingest kept evicting each other; the group queues them now.)
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
python scripts/remove_games.py
python scripts/ingest_new.py

# Name the commit after what changed: the queue file is emptied only when
# ingest_new.py processed something.
if git diff --quiet -- scripts/temp_info.jsonl; then
  msg="Apply removals [$(date +'%Y-%m-%d %H:%M')]"
else
  msg="Ingest games [$(date +'%Y-%m-%d %H:%M')]"
fi
bash "$(dirname "$0")/commit_push.sh" "$msg"
