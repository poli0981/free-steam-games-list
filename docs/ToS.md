# TERMS OF USE

By accessing, forking, contributing to, mirroring, scraping, or otherwise using this repository (`free-steam-games-list`) or the deployed Pages site, you agree to these Terms of Use, the [MIT License](../LICENSE), and the supplemental [Disclaimer](./DISCLAIMER.md). The MIT text governs in case of conflict.

---

### 1. Use at your own risk

The repository is a curated list of free-to-play games on Steam plus a static web app reading the same list. Your decisions to download, install, run, or play any listed game are entirely your own.

### 2. No endorsement, no quality guarantee

Inclusion in the list is **not** an endorsement, recommendation, or warranty. Most entries are added because they are flagged free-to-play on Steam by the daily pipeline, not because they were reviewed or vouched for. The `safe` field reflects the maintainer's personal usage only, not a formal audit.

### 3. Specific accuracy caveats

You acknowledge the following:

1. **Genre is heuristic.** The genre column is derived from Steam tags + a description-text parser. Hybrids, indie experiments, and non-traditional titles are frequently mis-bucketed. Use the `tags` array for the unfiltered set.
2. **English-only assumptions.** The scraper, ingest pipeline, and web app assume Steam responses come back in English. Regional storefronts can return localised strings that break parsing. Names, genres, language-support tables, and DLC flags can be wrong for non-EN sessions. Compare against the canonical EN store page before acting on the data.
3. **Test data may have leaked in.** During web-app development, the maintainer ran live edit / add / delete tests against the production repo. Some rows may carry test artefacts; the daily pipeline cleans most of these up but stragglers exist.
4. **`unsigned` Activity entries are dev artefacts.** Many commits during development were made while the GPG key was locked. They are not malicious — just unsigned. If you require Verified-only trust, filter the Activity feed accordingly.
5. **Anti-cheat detection is regex-based.** `anti_cheat` / `is_kernel_ac` are populated by matching known AC names against page text; rebrands and launcher-only mentions are missed.
6. **Player counts are sampled.** `current_players` and `peak_today` lag by minutes-to-hours.

### 4. Liability

See [`DISCLAIMER.md`](./DISCLAIMER.md). Short version: the maintainer is not responsible for anything related to the listed games or the data. Bad games, wasted time, toxic players, surprise microtransactions, kernel-AC conflicts — not the maintainer's problem.

### 5. Contributions

Pull requests are welcome but optional to merge. By submitting a contribution you license it under the same MIT terms as the rest of the repo. Don't include code or data you don't have the right to share.

#### 5.1 Sharing personal information when contributing

For the Telegram-bot contribution path ([`@my_skull_bot`](https://t.me/my_skull_bot), see [`CONTRIBUTING.md`](../CONTRIBUTING.md)):

1. **Your Telegram `user_id` must be sent via a private channel only** — Telegram DM, email, or any 1-on-1 chat. Posting it in public Discord channels, public Telegram groups, GitHub issues, or any other public surface is forbidden by these Terms; the maintainer will reject IDs that arrived via public channels and ask for a re-send.
2. **You retain control of your data.** The maintainer's allowlist is local and unpublished. You can request removal at any time via the same private channels. Removal blocks future bot use; previously-ingested game records remain in the public dataset since they are unattributed Steam-link submissions and form part of the curated MIT-licensed list.
3. **No other personal information should be transmitted.** The bot needs only your `user_id`. Real names, addresses, payment info, government IDs, biometric data, or any sensitive personal data should NOT be sent — the maintainer is a hobbyist with no infrastructure for handling them, and the bot does not request them.
4. **Public-channel discussion of `user_id`s is a security issue.** If you accidentally post a Telegram `user_id` (yours or anyone else's) in a public channel of this project, edit/delete it immediately and notify the maintainer via DM. The maintainer will assist with cleanup but cannot recall messages already mirrored by third parties.

These rules are non-negotiable: they protect contributors from doxxing and the maintainer from liability.

### 6. Trademarks & third-party content

- Steam, the Steam logo, VAC, BattlEye, EAC, Vanguard, etc., are trademarks of their respective owners. Their use here is descriptive / nominative.
- Game titles, screenshots (header images served from Akamai's `shared.akamai.steamstatic.com`), developer names, and publisher names belong to their respective owners. Their inclusion in a list does not imply endorsement of this project by them, or vice versa.

### 7. Forking, mirroring, derivative works

Allowed under the MIT terms. Carry the licence text with you and attribute the original repo. If you build something that financially benefits from the list, you are not obligated to share the proceeds — but a "thanks" via [Ko-fi / Patreon](https://ko-fi.com/skullmute) is appreciated.

### 8. No commercial drama

You can fork and modify; the maintainer can't help if your downstream project blows up, gets DMCA'd, or has a launch-day disaster. The MIT licence's no-warranty clause covers this.

### 9. Updates

Zero promises. Updates happen on the maintainer's whim plus GitHub Actions cron. The `last_updated` field in `data/index.json` is the canonical timestamp.

### 10. Governing law

Whatever GitHub's Terms of Service require, plus Vietnamese law where applicable, plus common sense. The maintainer is not a lawyer; nothing here is legal advice.

### 11. Changes to these terms

This document may change without notice. The repo commit history is the change log. Continued use means acceptance of the latest version.

---

Questions: open an [issue](https://github.com/poli0981/free-steam-games-list/issues). Keep it civil; off-topic / spam will be ignored.
