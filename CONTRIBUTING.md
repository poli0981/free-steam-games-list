# Contributing to Awesome Free-to-Play Games on Steam

Yo, thanks for stopping by! This repo is a hobby project by a broke, unemployed Vietnamese dev (20-something, introvert max level, dropped out uni year 3, mooching off family, Steam library 400+ games 80% under $10 sale addiction). Powered ~70% by AI assistants — Grok for v1, Claude for v2+ — the only non-judgmental friends keeping this alive while I play Easy mode only :))

Want to help? Awesome — no strict rules, life's hard enough. Pick whichever path below is least-friction for you.

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

### 1. Open an issue (bugs, requests, removals)

Go to the [Issues tab](https://github.com/poli0981/free-steam-games-list/issues/new/choose) and pick a template:

- ➖ **Delete game** (max 10 per issue)
- 🐛 **Bug report**
- 💡 **Feature request / improvement**
- 📢 **Feedback / rant**
- ❓ **Off-topic**

Fill the form (checkboxes, dropdowns, short descriptions). Every template is reviewed by hand when caffeine hits — none of them auto-run a workflow.

> Issues are for **reports**, not game submissions. To suggest a game, see section 2.


### 2. Suggest a game, or a correction

New free games are found on Steam automatically every day and reviewed before they are listed, so most turn up on their own. If one is still missing a few days after it went free, or a published game has something wrong (genre, anti-cheat, notes…), post it in [Discussions › Ideas](https://github.com/poli0981/free-steam-games-list/discussions/categories/ideas) with the store link. A correction becomes an override that every pipeline run keeps.

The companion browser extension ([steam-f2p-extension](https://github.com/poli0981/steam-f2p-extension)) is archived and no longer a way in.

### 3. Manual: fork + commit (most invasive)

For code changes, or to queue games yourself:

1. Fork → branch.
2. Edit code in `scripts/` / `web/src/` / docs, or append store links to `scripts/temp_info.jsonl`:
   ```jsonl
   {"link": "730"}
   {"link": "https://store.steampowered.com/app/570/"}
   ```
3. Push → open PR. Reviewer (= me) will look when caffeine hits.

A queued line is a link and nothing else: any other key is ignored, and the game is fetched from Steam and checked (free, a game, reachable) before it is published.

---

## Tips for smooth contributions

- **Games must be free-to-play on Steam.** No demos, no paid-now games, no malware-flagged ones.
- **Notes / safe** are worth mentioning in a suggestion ("safe to play", "Toxic max", "Grind phê Easy mode"); the maintainer records them as overrides.
- **Spam / off-topic** issues get closed without comment. Don't be that person.
- **Code style:** match the surrounding file. No hard rules. The Python pipeline is intentionally low-ceremony; the web side (SvelteKit, the Worker, `admin/`) is TS-strict.
- **Tests:** for web changes, `npm run typecheck && npm test && npm run build` must pass (in `web/`). For pipeline changes, `python -m pytest scripts/tests`.

## Code of conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Be chill.

---

Thanks for making this noob repo better! Star if you find a hidden gem, or buy me a coffee via [FUNDING.yml](.github/FUNDING.yml) to fuel instant noodles + more sale games ✨

Questions? Open an issue — that's contributing too :))
