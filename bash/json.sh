#!/bin/bash

# Install python dependencies
pip install requests

# Run python script
python scripts/update_data.py

# Check if files are updated
ls -la scripts/

# Commit changes if any
git config --global user.name "poli0981"
git config --global user.email "127664709+poli0981@users.noreply.github.com"
git status
git add .
if git diff --cached --quiet; then
    echo "No diff detected"
    git commit --allow-empty -m "JSON updated (timestamp update) [$(date +'%Y-%m-%d %H:%M')]" || echo "Empty commit
    skip"
else
    git commit -m "JSON updated [$(date +'%Y-%m-%d %H:%M')]"
fi
    git push || echo "Push fail – check token/permission bro"