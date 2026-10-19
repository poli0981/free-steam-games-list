#!/bin/bash
set -euo pipefail
pip install --quiet --require-hashes --only-binary :all: -r requirements.txt
python scripts/update_reviews.py
bash "$(dirname "$0")/commit_push.sh" "Update reviews [$(date +'%Y-%m-%d')]"
