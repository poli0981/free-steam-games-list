# Telegram bot — `@my_skull_bot`

This is a pointer page. The **canonical user guide** lives in the bot's own repository:

📖 **[poli0981/telegram-scraper-bot › docs/USER_GUIDE.md](https://github.com/poli0981/telegram-scraper-bot/blob/main/docs/USER_GUIDE.md)** — full command reference, edge cases, troubleshooting.

🔗 **Bot source:** <https://github.com/poli0981/telegram-scraper-bot>

🤖 **Bot handle:** [@my_skull_bot](https://t.me/my_skull_bot) ([QR](../assets/qr/telegram-bot.png))

## What it does (in one paragraph)

`@my_skull_bot` (a.k.a. *Scraper Info Game bot*) is a contributor convenience: instead of opening a GitHub issue or signing into the web app, you DM the bot a few Steam URLs and it dispatches the [`Bot Ingest` GitHub Actions workflow](../.github/workflows/bot-ingest.yml) on your behalf. The workflow appends your links to `scripts/temp_info.jsonl`, runs the same metadata fetch + dedup the daily pipeline uses, commits the result, and edits the bot's own Telegram message in real time with the outcome — `✅ Steam ingest done` or `❌ Steam ingest failed` with a workflow-run link.

## How it works (lifecycle)

1. **Whitelist (one-time)** — DM the maintainer privately on Telegram with your numeric `user_id`. The bot rejects messages from non-whitelisted IDs. **Never** post your `user_id` in public Discord, public Telegram groups, or GitHub issues.
2. **Send Steam URLs** — full URL, short URL, or bare appid; one per line or one per message.
3. **Bot validates + fetches metadata** — locally on the maintainer's machine.
4. **Bot dispatches GitHub Actions** — passing your queue + your `chat_id` + the bot's own `message_id`.
5. **GitHub Actions ingests** — same path as the daily pipeline. Commits + pushes if there are new records.
6. **Bot edits its message** — success ✅ with summary, or failure ❌ with workflow-run link for debugging.

For the full step-by-step (whitelist setup, command reference, what each prompt means, how to bulk-queue, troubleshooting), read the **[USER_GUIDE.md](https://github.com/poli0981/telegram-scraper-bot/blob/main/docs/USER_GUIDE.md)** in the bot repo.

## Privacy first

> [!WARNING]
> Personal info — Telegram `user_id`, email, real name — should travel through DM only. **Do not** post your `user_id` in public Discord channels (including the project's own `#general`), public Telegram groups, GitHub issues, PR comments, commit messages, or public posts on X / Bluesky / Mastodon.
>
> The bot rejects messages from non-whitelisted IDs, so leaking the ID does not grant strangers access — but it still leaks your Telegram identity to anyone watching that channel. See [`../docs/PRIVACY_POLICY.md`](PRIVACY_POLICY.md) and [`../docs/ToS.md`](ToS.md) for the formal policy.

## Availability

The bot runs in **Docker on the maintainer's local machine**, ~2–5 hours per day depending on availability. There is no SLA. If it's offline, your messages sit unread until it's back up.

## Related

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — section 3 has the in-repo flow + whitelist instructions
- [`../.github/workflows/bot-ingest.yml`](../.github/workflows/bot-ingest.yml) — the Actions workflow the bot dispatches
- [`../AUTHORS.md`](../AUTHORS.md) — maintainer DM channels for whitelist requests
- [`../assets/qr/telegram-bot.png`](../assets/qr/telegram-bot.png) — bot QR code
- [`../assets/qr/telegram-user.png`](../assets/qr/telegram-user.png) — maintainer DM QR code
