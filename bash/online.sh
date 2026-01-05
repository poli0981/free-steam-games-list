#!/bin/bash

# install dependencies
pip install requests tqdm

# run the online script
python scripts/top_online.py

# check file updated
ls -la
ls -la games/ || echo "games folder empty bro :("
ls -la scripts/

# Commit changes
git config --global user.name 'github-actions[bot]'
    git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git status
git add games/top-online.md
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "Auto update tables online top & stats [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
