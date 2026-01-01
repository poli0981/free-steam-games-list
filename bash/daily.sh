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
git add games/*.md
git status
if git diff --cached --quiet; then
    echo "No diff detected"
    git commit --allow-empty -m "Auto regenerate tables (timestamp update) [$(date +'%Y-%m-%d %H:%M')]" || echo "Empty commit skip"
else
    git commit -m "Auto regenerate tables from data.json [$(date +'%Y-%m-%d %H:%M')]"
fi
    git push || echo "Push fail – check token/permission bro"