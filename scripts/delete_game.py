# Delete game
import json

# Path to JSON file
json_path = "data.json"

# Load JSON
with open(json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

print("Enter link of the game: ")
link = input()
if link in [g["link"] for g in data]:
    for game in data:
        if game["link"] == link:
            data.remove(game)
            break
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    print("Game deleted")
else:
    print("Game not found. Run code again & Try again :)")

