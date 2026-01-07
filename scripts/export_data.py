# Export data from JSON file -> CSV
import pandas
import json

# Path to JSON file
json_path = "scripts/data.json"

# Load JSON
with open(json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

# Convert to CSV
pandas.read_json(json_path).to_csv("../data.csv", index=False)

# If you want to export file with Excel, remove '#' to use.
# pandas.read_json(json_path).to_excel("../data.xlsx", index=False)