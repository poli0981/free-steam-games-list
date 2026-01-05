#!/bin/bash

# run python script
python scripts/generate_tables.py

# check file updated
ls -la
ls -la games/ || echo "games folder empty bro :("

# Commit changes
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git status
git add .
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "Auto update tables [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
