# PRIVACY POLICY

**Effective date:** whenever this file was first committed (see git history). Updates are documented in commit log.

### Short version

This repository and the static Pages site at <https://poli0981.github.io/free-steam-games-list/> collect **no personal data on the maintainer's side**.

There is no backend, no server-side log, no analytics SDK, no advertising tracker, no fingerprinting library. Everything happens client-side in your browser, against either GitHub's API or `raw.githubusercontent.com`.

---

### What the maintainer does NOT collect

- No accounts, sign-ups, or sessions on this side.
- No analytics. No Google Analytics, Plausible, Fathom, etc.
- No cookies set by this domain.
- No advertising / behavioural-ad tracking.
- No fingerprinting.
- No server-side request logging — there is no server other than GitHub's CDN.
- No data sent to third-party SDKs.

### What runs in your browser

The static web app fetches:

- `https://raw.githubusercontent.com/poli0981/free-steam-games-list/main/data/*.jsonl` — the game data.
- `https://api.github.com/...` — only when the user signs in with their own GitHub PAT for editing/adding/deleting. Never from anonymous visitors.
- `https://shared.akamai.steamstatic.com/store_item_assets/.../header.jpg` — Steam game header images. Each `<img>` tag emits an HTTP GET to Akamai; Akamai's standard CDN logs apply.
- `https://avatars.githubusercontent.com/...` — the signed-in user's avatar, only when authenticated.

These third-party endpoints have their own privacy policies and may log your IP / User-Agent according to their terms:

- **GitHub** — [Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).
- **Akamai** — see Steam's [Privacy Policy](https://store.steampowered.com/privacy_agreement/) (Akamai is Steam's CDN).

### What stays local in your browser

The web app uses three local-storage mechanisms:

1. **`localStorage`** — your GitHub PAT (only if you sign in), your selected GPG key (encrypted by the key's own passphrase), your theme + auto-lock preferences. Nothing is uploaded.
2. **IndexedDB** — a cache of the JSONL records keyed on `data/index.json.last_updated`, so reloads are fast. Nothing is uploaded.
3. **Service Worker cache** — the app shell + the last-known data shards, for offline browsing. Nothing is uploaded.

You can clear all of the above at any time via your browser's site-data settings ("Clear site data" works fully).

### What the *editing* path actually sends

Only when you sign in and edit, add, or delete:

- Your PAT goes only to `api.github.com`, never anywhere else.
- The commits you make are public on the repo and visible to anyone — that is by design. Author and committer email come from your GPG key's user ID (when unlocked) or from GitHub's noreply email format (when the key is locked). The web app never alters these without your input.

### LLM / AI

About 70 % of the code in this repo was generated with help from Grok (v1) and Claude (v2+). Those LLM calls happen on the maintainer's development machine — never from your browser. No user data is sent to any AI service at runtime.

### Children

This is a directory of free-to-play Steam games. Steam itself has age-rating guidance per game; consult that before letting minors install anything found here. The maintainer does not moderate game content for age-appropriateness.

### Changes

If anything in this policy changes (it probably won't), the diff is in the repo commit history.

### Contact

Open an issue or use any of the channels listed in [`Contact.md`](./Contact.md). Privacy-specific questions: tag the issue `privacy`.

---

The maintainer has no server, no backend, and no commercial motive to collect user data — and is not interested in starting now.
