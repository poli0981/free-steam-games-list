#!/bin/bash

pip install pandas
python scripts/export_data.py
ls -la
ls -la/scripts
git config --global user.name 'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git status
git add .
git diff --staged --quiet && echo "No changes – skip commit" || (git commit -m "Auto update CSV [$(date +'%Y-%m-%d')] by GitHub Action" && git push)
