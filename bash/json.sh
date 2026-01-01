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
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "JSON updated [$(date+'%Y-%m-%d')]" && git push)