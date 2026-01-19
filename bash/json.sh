#!/bin/bash

# Install python dependencies
pip install requests jsonlines

# Run python script
python scripts/update_data.py

# Check if files are updated
ls -la scripts/

# Commit changes if any
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git status
git add .
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "Auto update tables online top & stats [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
