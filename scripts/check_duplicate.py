# Check duplicate links
import json

# Path to JSON file
json_path = "data.json"

# Load JSON
with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Check for duplicate links
duplicates = []
for i in range(len(data)):
    for j in range(i + 1, len(data)):
        if data[i]['link'] == data[j]['link']:
            duplicates.append(data[i]['link'])
            break

# Print duplicates
if duplicates:
    print("Duplicate links found:")
    for link in duplicates:
        print(link)
else:
    print("No duplicate links found.")