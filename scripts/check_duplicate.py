# Check duplicate links
import json

# Path to JSON file
json_path = "data.json"

# Load JSON
with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Check for duplicate links
seen_links = set()
duplicates = []

for item in data:
    link = item['link']
    if link in seen_links:
        duplicates.append(link)
    else:
        seen_links.add(link)

# Print duplicates
if duplicates:
    print("Duplicate links found:")
    for link in duplicates:
        print(link)
else:
    print("No duplicate links found.")
