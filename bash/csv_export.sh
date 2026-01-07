#!/bin/bash

pip install pandas
python scripts/export_data.py
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add .
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "Auto update tables online top & stats [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
