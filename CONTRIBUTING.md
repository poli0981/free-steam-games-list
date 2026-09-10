# Contributing to Awesome Free-to-Play Games on Steam

Yo, thanks for stopping by! This repo is a hobby project by a broke, unemployed Vietnamese dev (20-something, introvert max level, dropped out uni year 3, mooching off family, Steam library 400+ games 80% under $10 sale addiction). Powered ~70% by AI assistants — Grok for v1, Claude for v2+ — the only non-judgmental friends keeping this alive while I play Easy mode only :))

Want to help? Awesome — no strict rules, life's hard enough. Pick whichever path below is least-friction for you.

## Maintainer contact

The canonical handle list is in [`AUTHORS.md`](AUTHORS.md) at the repo root (mirror of [`username.txt`](username.txt) for human reading). Web-app version: <https://free-steam-games.win/#/about>.

> [!WARNING]
> **Privacy first.** When sending your Telegram `user_id` (needed for the bot whitelist below), **DM the maintainer privately**. Do **not** post it in:
> - Public Discord channels (including the project's own `#general`).
> - Public Telegram groups or super-groups.
> - GitHub issues, PR comments, or commit messages.
> - Public posts on X / Bluesky / Mastodon / YouTube comments.
>
> Personal info — Telegram `user_id`, email, real name, etc. — should travel through DM only. The maintainer will not ask you for anything beyond the `user_id` for the bot.

---

## How to contribute

### 1. Open an issue (bugs, requests, removals)

Go to the [Issues tab](https://github.com/poli0981/free-steam-games-list/issues/new/choose) and pick a template:

- ➖ **Delete game** (max 10 per issue)
- 🐛 **Bug report**
- 💡 **Feature request / improvement**
- 📢 **Feedback / rant**
- ❓ **Off-topic**

Fill the form (checkboxes, dropdowns, short descriptions). Every template is reviewed by hand when caffeine hits — none of them auto-run a workflow.

> Issues are for **reports**, not game submissions. To add a game, use the browser extension (section 2).


### 2. Browser extension

The companion [Chrome extension](https://github.com/poli0981/steam-f2p-extension) detects F2P games on Steam store pages and pushes pre-fetched metadata to `scripts/temp_info.jsonl`. The `Ingest New Game Links` workflow merges and dedupes on push.

### 3. Manual: fork + commit (most invasive)

For code changes or bigger data edits:

1. Fork → branch.
2. Edit code in `scripts/` / `web/src/` / docs, or append rows to `scripts/temp_info.jsonl`:
   ```jsonl
   {"link": "730", "type_game": "online", "safe": "y", "notes": "CS2 babyyy"}
   {"link": "https://store.steampowered.com/app/570/", "genre": "MOBA"}
   ```
3. Push → open PR. Reviewer (= me) will look when caffeine hits.

Manual fields preserved through the ingest pipeline: `type_game`, `genre`, `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `safe`, `notes`.

---

## Tips for smooth contributions

- **Games must be free-to-play on Steam.** No demos, no paid-now games, no malware-flagged ones.
- **Notes / safe fields** are optional but useful. Examples: `"safe": "y"`, `"notes": "Toxic max"`, `"notes": "Grind phê Easy mode"`.
- **Spam / off-topic** issues get closed without comment. Don't be that person.
- **Code style:** match the surrounding file. No hard rules. The Python pipeline is intentionally low-ceremony; the React/Vite side is TS-strict.
- **Tests:** there's no formal test suite for the data pipeline. For web changes, `npm run typecheck && npm run build` must pass.

## Code of conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Be chill.

---

Thanks for making this noob repo better! Star if you find a hidden gem, or buy me a coffee via [FUNDING.yml](.github/FUNDING.yml) to fuel instant noodles + more sale games ✨

Questions? Open an issue — that's contributing too :))
