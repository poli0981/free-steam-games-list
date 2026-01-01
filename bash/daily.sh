#!/bin/bash

# run python script
python scripts/generate_tables.py

# check file updated
ls -la
ls -la games/ || echo "games folder empty bro :("
ls -la scripts/

# Commit changes
git config --global user.name "poli0981"
git config --global user.email "127664709+poli0981@users.noreply.github.com"
git status
git add .
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "Auto update tables online top & stats [$(date +'%Y-%m-%d')]" && git push)