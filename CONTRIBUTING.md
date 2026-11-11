# Contributing to Awesome Free-to-Play Games on Steam

Yo, thanks for stopping by! This repo is a hobby project by a broke, unemployed Vietnamese dev (20-something, introvert max level, dropped out uni year 3, mooching off family, Steam library 400+ games 80% under $10 sale addiction). Powered ~70% by AI assistants — Grok for v1, Claude for v2+ — the only non-judgmental friends keeping this alive while I play Easy mode only :))

Want to help? Awesome — life's hard enough, so the rules are short.

## Project status: stable, maintenance only

Since 2026-11-11 the project is finished rather than abandoned. The pipeline
still refreshes the list every day and the site and apps stay up, but the code
is no longer growing:

- **No new features.** Feature requests are not taken, as issues, discussions
  or pull requests. A pull request that adds one is closed, however good it is.
- **Code changes only for** security advisories (CVEs), runtime and dependency
  updates (Node, Python, Rust, the npm / pip / cargo packages, the GitHub
  Actions), and whatever those break. Dependabot opens most of them.
- **Issues and pull requests are for the data:** adding a game, correcting one,
  removing one.
- Something **broken** (the site, an app, a wrong number) or an
  **accessibility barrier** can still be reported. It gets a fix, not a
  redesign.
- A **vulnerability** goes through [`SECURITY.md`](SECURITY.md), never a public
  issue.

Forks are welcome to go further: the code is MIT and the dataset CC BY 4.0.

## Maintainer contact

The canonical contact list is in [`AUTHORS.md`](AUTHORS.md) at the repo root
(machine-readable mirror: [`username.txt`](username.txt); the chatty version is
[`docs/Contact.md`](docs/Contact.md)). Web-app version:
<https://free-steam-games.win/about>.

Short version: **contact@poli0981.dev** for anything private,
**security@poli0981.dev** for a vulnerability (after GitHub's private
reporting, see [`SECURITY.md`](SECURITY.md)), and <https://poli0981.dev/> or
<https://poli0981.dev/links/> for everything else.

> [!WARNING]
> **Privacy first.** Issues, PR comments and commit messages are public and
> permanent — GitHub keeps them in the fork network even after deletion. Keep
> personal information (email, real name, account IDs) out of them and send it
> by email instead. The maintainer will never ask you for an account ID, a
> token, or a password: there is no whitelist to join and nothing to verify.

---

## How to contribute

### 1. Open an issue

Go to the [Issues tab](https://github.com/poli0981/free-steam-games-list/issues/new/choose) and pick a form:

- ➕ **Add game** — a free game that is still missing (max 10 per issue)
- ✏️ **Edit game** — a published game with something wrong: genre, type, anti-cheat, notes, safe
- ➖ **Delete game** — paid now, not a game, malware, duplicate (max 10 per issue)
- 🐛 **Bug report** — something that is broken
- ♿ **Accessibility barrier** — something you can't use with a keyboard, a screen reader or zoom (see [`ACCESSIBILITY.md`](ACCESSIBILITY.md))

Blank issues are off. Every form is reviewed by hand when caffeine hits — none of them auto-run a workflow.

New free games are found on Steam automatically every day and reviewed before they are listed, so most turn up on their own. Use **Add game** for one that is still missing a few days after it went free.

### 2. Open a pull request (data)

Fork → branch → one of these → push → open the PR. The template has a short checklist.

**Add a game:** append store links to `scripts/temp_info.jsonl`.

```jsonl
{"link": "730"}
{"link": "https://store.steampowered.com/app/570/"}
```

A queued line is a link and nothing else (full URL, short URL or bare appid): any other key is ignored, and the game is fetched from Steam and checked (free, a game, reachable) before it is published.

**Correct a game:** add an override. It is a standing instruction in `data/overrides/<appid>.json` that every pipeline run keeps.

```bash
python scripts/edit_game.py 730 --show
python scripts/edit_game.py 730 --set genre="FPS" --reason "Steam's genre is too coarse"
```

Only the human-judged fields can be overridden: `genre`, `type_game`, `safe`, `notes`, `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`. Everything else (name, tags, languages, reviews, players…) is whatever Steam says and is refreshed from Steam.

**Remove a game:** add a blocklist line. The reason and the note are public.

```bash
python scripts/delete_game.py 730 --reason not_free --note "paid since 2026-11"
```

Reasons: `not_free`, `not_a_game`, `duplicate`, `broken`, `inappropriate`, `other`.

Leave out `--apply` in both commands, and **never edit `data/data_*.jsonl` or `data/index.json` by hand**: the pipeline rewrites them on its next run and an edit there is lost (and breaks the hashes the apps check). `Check Overrides` validates an override or blocklist change on the pull request.

### 3. Pull requests that touch code

Only two kinds are merged now:

- a **security fix** — report it privately first ([`SECURITY.md`](SECURITY.md));
- a **runtime or dependency update**, or the repair of what one broke.

`npm run typecheck && npm test && npm run build && node scripts/verify-dist.mjs --web` must pass in `web/`, and `python -m pytest scripts/tests` for the pipeline. Dependencies are pinned and hashed; the rules are in [`CLAUDE.md`](CLAUDE.md) ("CI installs only what is pinned").

The companion browser extension ([steam-f2p-extension](https://github.com/poli0981/steam-f2p-extension)) is archived and no longer a way in.

---

## Tips for smooth contributions

- **Games must be free-to-play on Steam.** No demos, no paid-now games, no malware-flagged ones.
- **Notes / safe** are worth mentioning in an Add or Edit request ("safe to play", "Toxic max", "Grind phê Easy mode"); the maintainer records them as overrides.
- **Spam / off-topic / feature-request** issues get closed without comment. Don't be that person.
- **Questions and chit-chat** go to [Discussions](https://github.com/poli0981/free-steam-games-list/discussions), not issues.

## Code of conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Be chill.

---

Thanks for making this noob repo better! Star if you find a hidden gem, or buy me a coffee via [FUNDING.yml](.github/FUNDING.yml) to fuel instant noodles + more sale games ✨

Questions? [Discussions](https://github.com/poli0981/free-steam-games-list/discussions) — that's contributing too :))
