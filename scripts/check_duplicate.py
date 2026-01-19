# Check duplicate links
import jsonlines

# Path to JSONL file
json_path = "scripts/data.jsonl"

# Load JSONL data
with jsonlines.open('scripts/test.jsonl', 'r') as reader:
    data = list(reader)

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
