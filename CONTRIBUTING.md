# Contributing to Awesome Free-to-Play Games on Steam

Yo, thanks for stopping by! This repo is a hobby project by a broke, unemployed Vietnamese dev (20-something, introvert max level, dropped out uni year 3, mooching off family, Steam library 400+ games 80% under $10 sale addiction). Powered ~70% by AI assistants — Grok for v1, Claude for v2+ — the only non-judgmental friends keeping this alive while I play Easy mode only :))

Want to help? Awesome — no strict rules, life's hard enough. Pick whichever path below is least-friction for you.

## Maintainer contact

The canonical handle list is in [`AUTHORS.md`](AUTHORS.md) at the repo root (mirror of [`username.txt`](username.txt) for human reading). Web-app version: <https://poli0981.github.io/free-steam-games-list/#/about>.

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

### 1. Quick + lazy: open an issue (preferred for most users)

Go to the [Issues tab](https://github.com/poli0981/free-steam-games-list/issues/new/choose) and pick a template:

- ➕ **Add new games** (max 15 links per issue)
- ➖ **Delete game** (max 10 per issue)
- 🐛 **Bug report**
- 💡 **Feature request / improvement**
- 📢 **Feedback / rant**
- ❓ **Off-topic**

Fill the form (checkboxes, dropdowns, short descriptions). The `Ingest from Issue` workflow auto-runs on the `[add-game]` template, validates, fetches Steam metadata, and closes the issue with a status comment. Other templates are reviewed manually when caffeine hits.

### 2. Sign in to the web app (for owner-equivalents)

If you have repo write access:

1. Open <https://poli0981.github.io/free-steam-games-list/>.
2. Settings → paste a Classic GitHub PAT (scopes: `repo` + `workflow`).
3. Optionally unlock a GPG private key in Settings to sign commits → **Verified ✓** badges.
4. Add via the `Add` page (single + JSON bulk) or edit/delete via the table drawers.

The web app commits via the Git Data API + GPG signing path. The optimistic-update layer means edits show up instantly without waiting for the Fastly CDN.

### 3. Scraper Info Game bot — `@my_skull_bot` on Telegram

Quick path for users who don't want a GitHub PAT but do want to add games. The bot wraps the same `ingest-new` pipeline behind a Telegram chat.

> **One-time setup (whitelist your Telegram `user_id`)**
>
> 1. **Find your Telegram `user_id`.** Easiest way: DM `@userinfobot` on Telegram and it replies with your numeric `user_id`. Other options: `@RawDataBot`, `@getmyid_bot`, or any "what's my Telegram ID" bot of your choice.
> 2. **DM the maintainer privately** with that `user_id`. Channels that work:
>    - Telegram DM: [@SkullMute0011](https://t.me/SkullMute0011) ([QR code](assets/qr/telegram-user.png))
>    - Email: `lopop05905@proton.me`
>    - X DM, Discord DM (NOT public channels), or any other private channel listed in [`AUTHORS.md`](AUTHORS.md).
>
>    **Strictly forbidden:** posting your `user_id` in any public channel — Discord `#general`, Telegram groups, GitHub issues, public X/Bluesky posts. The bot rejects messages from non-whitelisted IDs, so leaking the ID to randoms doesn't grant them access — but it still leaks your Telegram identity to anyone watching that channel.
> 3. Maintainer adds your `user_id` to the bot's whitelist. You only do this **once**.

> **Each session (when you want to add games)**
>
> 4. **Check whether the bot is online.** The bot runs **locally on the maintainer's machine via Docker**, ~2–5 hours per day depending on availability. If it's offline, your messages will sit unread until it comes back up. There is no SLA.
> 5. **Open the bot:** [@my_skull_bot](https://t.me/my_skull_bot) ([QR code](assets/qr/telegram-bot.png)).
> 6. **Send Steam URLs** (one per line, or one per message — bot accepts either). Full URLs, short URLs, and bare appids all work:
>    ```
>    https://store.steampowered.com/app/730/
>    570
>    https://store.steampowered.com/app/440/
>    ```
> 7. **Follow the bot's prompts.** It validates URLs, fetches metadata via the Steam API, optionally lets you set manual fields (`type_game`, `genre`, `notes`, `safe`), and dispatches the `Bot Ingest` GitHub Actions workflow with your queue.
> 8. **Wait for the workflow to finish.** The bot edits its own message with the result — `✅ Steam ingest done` + summary line, or `❌ Steam ingest failed` with a link to the workflow run for debugging.

The bot itself is open-source companion code (separate repo). The workflow it dispatches lives in [`.github/workflows/bot-ingest.yml`](.github/workflows/bot-ingest.yml).

### 4. Chrome extension (for power users)

The companion [Chrome extension](https://github.com/poli0981/free-steam-games-list-extension) detects F2P games on Steam store pages and pushes pre-fetched metadata to `scripts/temp_info.jsonl`. The `Ingest New Game Links` workflow merges and dedupes on push.

### 5. Manual: fork + commit (most invasive)

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
