# DOCS + LEGAL REWORK — DESIGN

Non-lawyer engineering recommendations throughout. Where I make a legal call I label it **[JUDGEMENT]** and state the assumption. Nothing here is legal advice; for a hobby project at this scale the goal is *defensible and honest*, not *litigation-proof*.

---

## 1. THE LICENSE SPLIT

### 1.1 What the project actually owns

I inventoried a real record (`data/data_001.jsonl` line 1) and ran a distribution over all 3,424:

```
description length: min 8 · p50 213 · p90 290 · p99 306 · max 340 · mean 200.5
empty: 0 · >300 chars: 48
```

Every record's `description` is Valve's `short_description` **verbatim**. That is ~686 KB of third-party marketing copy, and it is the only genuinely load-bearing legal problem in the dataset.

| Field group | Fields | Who owns it | Licensable by this project? |
|---|---|---|---|
| Maintainer's original judgement (`MANUAL_FIELDS`) | `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `notes`, `type_game`, `safe`, `genre` | poli0981 | **Yes, cleanly.** This is the only part with unambiguous authorship. |
| Project-generated | `status`, `is_dead`, `zero_player_since`, `last_updated`, `added_at`, shard/index structure | poli0981 | **Yes.** |
| Facts & short factual strings | `link`, `developer[]`, `publisher[]`, `release_date`, `platforms[]`, `languages[]`, `language_details[]`, `metacritic`, `drm_notes`, `reviews`, `current_players`, `peak_today` | nobody (facts) | **N/A — no copyright to license.** The *compilation* of them may carry thin rights. |
| Titles & marks | `name`, `tags[]` | publishers / Valve | **No.** Titles aren't copyrightable; they are trademarks. Nominative use only. |
| Third-party expression | `description` | game publishers | **No.** |
| Third-party asset pointer | `header_image` | publishers, hosted by Valve/Akamai | The **URL string** is fine. The **image** is not the project's, and after the Cloudflare migration the project starts re-encoding and re-serving it (see §1.4). |

**Copyright analysis [JUDGEMENT]:**

- **US** — *Feist v. Rural* kills any claim to the facts. A compilation gets only "thin" copyright in original selection and arrangement. The selection rule here is mechanical ("is this flagged free-to-play on Steam?"), so the thin copyright rests almost entirely on `MANUAL_FIELDS` plus the schema/arrangement. Assumption: the project is not asserting a strong compilation copyright and should not pretend to.
- **EU sui generis database right (Dir. 96/9/EC)** — this *would* fit: daily scraping since 2025, health-checking, dedup, verification = "substantial investment in obtaining and verifying." But Art. 11 restricts the right to makers who are EU/EEA nationals or have habitual residence / registered office in the EEA. The maintainer is resident in Vietnam. **Assumption: no EU sui generis right subsists.** You cannot license a right you don't hold — which is a strong argument *against* ODbL (below).
- **Vietnam** — Law on IP Art. 14.2 protects compilations of data where selection/arrangement is creative. Same thin-protection outcome.
- **Steam's terms** — the Steam Web API Terms of Use permit API use but do not transfer rights in the content; HTML scraping of store pages (`scripts/core/scraper.py`) sits outside that agreement entirely. **Assumption: Valve tolerates this class of project** (SteamDB, SteamSpy, etc. all operate the same way) and the realistic risk is a takedown notice from a *single publisher* about *its own* description, not a suit from Valve. That shapes the whole recommendation: build the takedown route, don't over-lawyer the license.

### 1.2 Recommendation: **MIT (code) + CC BY 4.0 (data)**

**Code → keep MIT.** Do not switch to Apache-2.0.
- There are no outside code contributors with patentable contributions (`AUTHORS.md:41-43` — contributors are issue-filers). Apache-2.0's patent grant and NOTICE machinery buys nothing here and adds per-file ceremony.
- MIT is already the license of record and the whole dep tree is MIT/Apache/BSD-compatible.
- `LICENSE:6` already says "the Software **and associated documentation files**", so `docs/` and `CHANGELOG.md` are already covered by the existing text — no third license needed for prose.

**Data → CC BY 4.0**, with an explicit third-party carve-out.

Why, ruling out each alternative for *this* dataset:

| Candidate | Verdict |
|---|---|
| **CC0 1.0** | ✗ Rejected. Attribution is the one thing the maintainer actually asks for (`README.md:236` "keep the credit if you fork"; `AUTHORS.md:56` "please keep the credit"). Worse, a CC0 dedication is an implicit assertion that *everything in the file is his to dedicate* — flatly false for `description`. |
| **ODbL 1.0** | ✗ Rejected. (a) It is copyleft — share-alike on derived databases plus a notice obligation on "Produced Works" — which contradicts the stated posture ("do whatever", `README.md:236`) and would break the Chrome-extension and Telegram-bot ecosystems' expectations. (b) Its machinery is built around the EU sui generis right, which per §1.1 almost certainly does not subsist here, so most of ODbL would operate as bare contract over thin rights. Maximum complexity, minimum effect. |
| **CDLA-Permissive-2.0** | ~ Runner-up. Genuinely the cleanest technical fit (purpose-built for data, no attribution-stacking, no share-alike). Rejected only on recognition: near-zero adoption, no GitHub license-picker entry, no data-catalog tooling support. |
| **CC BY 4.0** | ✓ **Chosen.** §2(b)(1) and §4 expressly license *sui generis database rights in addition to copyright*, so the EU angle is covered if it ever attaches (e.g. a future EEA co-maintainer). §2(a)(2) expressly grants no rights the licensor doesn't hold — which is exactly the honest framing the Valve-derived fields require, built into the license text itself rather than bolted on. Attribution-only matches the actual ask. It is the de-facto standard for open datasets and is machine-readable. |

### 1.3 The `description` field — recommendation

Three real options:

**(a) Keep verbatim, carve it out.** Declare `description` third-party content excluded from the CC BY grant, attributed to the publisher, with a takedown route. Zero engineering cost, moderate residual exposure (you are redistributing 3,424 complete short works).

**(b) Truncate in the pipeline to ~180 chars at a word boundary + always render a "Read on Steam" link.** ← **Recommended.**

**(c) Drop the field; fetch on demand client-side.** Strongest legal position, but it kills offline browsing (the IndexedDB/Workbox cache at `web/src/lib/cache.ts`), kills description search in Fuse.js, and breaks `games/*.md` generation. Highest cost by far.

**Recommend (b), combined with (a)'s carve-out framing.** Justification:

- The weak point in a fair-use / quotation analysis is *amount and substantiality*: today the project takes **100%** of each short work. Cutting to ~180 chars against a p50 of 213 takes roughly 60–85%, converting "a copy" into "an excerpt". That is the single highest-leverage change available, and it is the factor most likely to matter.
- It is *already what the markdown tables do* — `scripts/generate_tables.py:133` calls `_short_desc(...)` and emits ~120-char excerpts. Truncating the JSONL merely makes the canonical store consistent with the derived one.
- The EU quotation exception (InfoSoc Art. 5(3)(d)) wants an excerpt, for a purpose, with attribution and a source link. Vietnam's Art. 25 is similar. An excerpt + a per-row Steam link satisfies the shape of both; a full dump does not.
- `description` is **not** in `MANUAL_FIELDS`, so `refetch_all.py` regenerates it — this is a pipeline change plus one large mechanical commit, not a schema migration.
- **[JUDGEMENT]** Assumption: the realistic threat is one publisher's DMCA notice. Truncation plus a working takedown address converts that from an incident into an email.

Implementation notes: truncate in `scripts/core/fetcher.py` at the point `description` is applied (word-boundary cut at ≤180 chars, append `…`), so every path — API, scraper, extension, bot — is covered. `web/src/lib/schema.ts` needs no change. Do not truncate destructively in `data_store.py`'s merge path or a re-shard could double-truncate.

### 1.4 The image path is a new exposure, and the docs must say so

Today `web/src/lib/image.ts` does two things: `headerToCapsule()` rewrites `header.jpg` → `capsule_184x69.jpg`, and `preferWebp()` sends large images through `images.weserv.nl`. The browser hotlinks; the project never stores or serves the pixels.

After the migration the Worker will `fetch(url, { cf: { image: {...} } })` and serve a **re-encoded copy from `free-steam-games.win`**. That is a different posture: the project moves from *linking* to *reproducing and communicating to the public*, on its own domain, at its own cost. **[JUDGEMENT]** Assumption: this is still defensible as thumbnail/index use (the classic *Perfect 10 v. Amazon* shape — small, transformative, index-serving) provided you (i) only ever transform *down* to thumbnail/capsule sizes, never full-size, (ii) allowlist `shared.akamai.steamstatic.com` as the only source origin (which you must do anyway for SSRF — see §4 scope), (iii) always link the thumbnail to the Steam page, and (iv) honour takedowns per-appid.

Write those four constraints down in `docs/DEPLOYMENT.md` **and** in the EULA trademark/third-party section, so they read as a deliberate policy rather than an accident.

### 1.5 An existing, unaddressed obligation: OpenPGP.js is LGPL-3.0+

Verified: `web/node_modules/openpgp/package.json` → `openpgp 6.3.0`, license `LGPL-3.0+`. It is already correctly labelled at `web/src/pages/About.tsx:81` and `docs/ACKNOWLEDGEMENTs.md:70`, but nothing acts on it.

MIT source that merely *depends* on LGPL is fine. The obligation attaches to the **distributed binaries**: the Tauri desktop bundles (`.msi`/`.dmg`/`.AppImage`/`.deb`) and the Android APK ship OpenPGP.js bundled into the JS payload. LGPL-3.0 §4 requires the recipient be able to relink against a modified OpenPGP.js, plus the LGPL text and a prominent notice.

Recommendation: since `web/` source is public and MIT, the relink path is satisfiable — but you must **say so**. Add to `docs/THIRD_PARTY.md` (or a new `docs/OSS_NOTICES.md`) a short "LGPL compliance" section: the license text, the version, the source URL, and a written offer. Attach that file as a release asset in `release-desktop.yml` / `release-android.yml`. This is a five-minute fix for a real obligation nobody has noticed.

### 1.6 Exact file layout

```
LICENSE                    # MIT, unchanged text; scope note added above it
LICENSE-DATA               # CC BY 4.0 full text, preceded by the carve-out preamble
data/LICENSE               # 12-line pointer → ../LICENSE-DATA
games/LICENSE              # 12-line pointer → ../LICENSE-DATA
docs/DATA_LICENSE_FAQ.md   # new, see §6
docs/OSS_NOTICES.md        # new: LGPL-3.0 notice for OpenPGP.js + full dep SPDX dump
```

Root `LICENSE` stays MIT so GitHub's license detector keeps calling this a MIT repo — correct, because it *is* a code repo. `data/LICENSE` and `games/LICENSE` exist because people download those folders alone.

**`LICENSE-DATA` preamble** (this is the operative text; draft it roughly as):

> ## Steam F2P Tracker — dataset license
>
> The dataset in `data/` and the generated tables in `games/` are licensed **CC BY 4.0** — *except for the third-party content listed below, which is not the maintainer's to license and is not licensed to you by this file.*
>
> **Covered by CC BY 4.0** — the selection, arrangement, schema, shard structure, and the maintainer's own annotations: `genre`, `type_game`, `safe`, `notes`, `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `status`, `is_dead`, `zero_player_since`, `added_at`, `last_updated`, and the `data/index.json` manifest.
>
> **NOT covered (third-party content, included under quotation/nominative use):**
> - `name` — game titles; trademarks of their publishers.
> - `description` — an excerpt (≤180 characters) of the publisher's own Steam store copy. Copyright remains with the publisher. Included as a short attributed quotation alongside a link to the source page.
> - `header_image` — a URL pointing at Valve's CDN. The image is the publisher's.
> - `tags` — Steam community tag strings.
> - `developer`, `publisher`, `metacritic`, `reviews` — factual attributions and third-party scores.
>
> Facts are not copyrightable anywhere this project operates. The maintainer makes **no** claim to any EU sui generis database right (he is not resident in the EEA), and CC BY 4.0 §2(a)(2) grants you no rights he does not hold.
>
> **How to credit:** "Steam F2P Tracker by poli0981 — https://free-steam-games.win — CC BY 4.0"
>
> **Takedown:** if you are a rightsholder and want your title's `description` or `header_image` removed, email `lopop05905@proton.me` with the appid. No lawyer required; it will be removed and added to a permanent exclusion list.

### 1.7 README licensing table (drop this immediately under the badges)

```markdown
### Licensing at a glance

| What | Path | License |
|---|---|---|
| Source code (Python pipeline, React SPA, Tauri shell, workflows) | `scripts/`, `bash/`, `web/`, `.github/` | [MIT](LICENSE) |
| Documentation | `docs/`, `*.md` at root | [MIT](LICENSE) (`LICENSE` covers "associated documentation files") |
| **Dataset** | `data/` | [**CC BY 4.0**](LICENSE-DATA) — attribution required |
| **Generated tables** | `games/` | [**CC BY 4.0**](LICENSE-DATA) |
| Steam titles, descriptions, header images, tags | inside `data/` | **Not licensed by this project.** See the [carve-out](LICENSE-DATA) and the [Data License FAQ](docs/DATA_LICENSE_FAQ.md). |
| Bundled third-party code | `web/node_modules` → shipped bundles | Their own licenses; see [OSS notices](docs/OSS_NOTICES.md). **OpenPGP.js is LGPL-3.0+.** |

Credit line for reuse: `Steam F2P Tracker by poli0981 — https://free-steam-games.win — CC BY 4.0`
```

### 1.8 SPDX headers policy

- **Python** (`scripts/**/*.py`, 21 files) and **shell** (`bash/*.sh`, 11 files): `# SPDX-License-Identifier: MIT` as the first line (after any shebang). Cheap, conventional, and `vulture`/`ruff` are indifferent.
- **TypeScript/TSX**: **do not** add per-file headers. ~200 files of churn, bundle bloat, and no consumer. Instead add `web/LICENSE` (copy of MIT) plus the `package.json` field below.
- **JSONL has no comment syntax.** Put the license in the manifest instead — add three top-level keys to `data/index.json`:
  ```json
  { "max_per_file": 800, "total": 3424, "last_updated": "…", "files": [...],
    "license": "CC-BY-4.0",
    "license_url": "https://github.com/poli0981/free-steam-games-list/blob/main/LICENSE-DATA",
    "attribution": "Steam F2P Tracker by poli0981 — https://free-steam-games.win" }
  ```
  This is additive; the manifest consumer in `web/src/lib/fetcher.ts` reads named keys and is unaffected. **Constraint:** the write path (`web/src/lib/git-data.ts`) rewrites `index.json` on every edit to bump `last_updated` — it must preserve these keys, not reconstruct the object from a template.
- **Generated markdown**: `scripts/generate_tables.py` already writes a footer near line 193; extend it to emit the CC BY credit line + carve-out pointer into every `games/*.md` and into `games/README.md`.
- **YAML workflows**: skip.

### 1.9 `web/package.json`

Currently `"name": "free-steam-games-web"`, `"private": true`, `"version": "1.4.4"`, **no `license` field** (lines 1-4). Add:

```json
"license": "MIT",
"author": "poli0981",
"repository": { "type": "git", "url": "https://github.com/poli0981/free-steam-games-list", "directory": "web" },
"homepage": "https://free-steam-games.win"
```

Keep `"private": true` — it only prevents accidental `npm publish` and carries no licensing meaning. A missing `license` field makes `npm ls --json`, license scanners, and SBOM tooling report the package as unlicensed, which is the opposite of the intent.

### 1.10 `.gitattributes` blocks the license split from reaching archives

`.gitattributes:15-22` currently `export-ignore`s `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `docs/Contact.md`, `docs/PRIVACY_POLICY.md`, `docs/ToS.md`. A `git archive` tarball — which is what GitHub's "Download ZIP" and release source assets produce — therefore ships **without the README (which carries the licensing table) and without the Terms and Privacy Policy.** After a license split that is actively harmful and arguably defeats CC BY's notice requirement.

**Fix: remove the export-ignore on `README.md`, `docs/ToS.md`, `docs/PRIVACY_POLICY.md`, `SECURITY.md`, and `CONTRIBUTING.md`.** Explicitly never export-ignore `LICENSE`, `LICENSE-DATA`, `data/LICENSE`, `games/LICENSE`, `docs/OSS_NOTICES.md`.

---

## 2. `docs/PRIVACY_POLICY.md` — REWRITE

### 2.1 Every claim that becomes false

| Line | Current claim | Post-migration reality |
|---|---|---|
| `:7` | "the static Pages site at `poli0981.github.io/...`" | Domain is `free-steam-games.win`, on Cloudflare. |
| `:9` | "There is no backend, no server-side log" | Cloudflare edge + a Worker + D1. |
| `:17` | "No cookies set by this domain" | Cloudflare Access sets `CF_Authorization` on `/admin`. |
| `:20` | "No server-side request logging — there is no server other than GitHub's CDN" | Cloudflare terminates TLS for every request. |
| `:25-31` | Lists 4 outbound endpoints | **Already wrong today** — omits `images.weserv.nl`, which `web/src/lib/image.ts` routes every large image through. That is an undisclosed third-party processor seeing visitor IPs *right now*. |
| `:39-43` | "three local-storage mechanisms"; describes only PAT / GPG key / theme | Misses `f2p:gh_user`, `f2p:gpg_autolock_min`, `f2p:gpg_preferred_uid`, `f2p:legal_consent`, and the sessionStorage chunk-reload flag in `web/src/lib/lazy.ts`. `:41` also mis-describes the GPG storage: the *armored private key* sits in `f2p:gpg_armored`, protected only by its own passphrase. |
| `:87` | "The maintainer has no server, no backend" | False. |

### 2.2 New data flows to enumerate

1. **Cloudflare edge (all traffic).** Visitor IP, User-Agent, TLS fingerprint, request path, country/ASN reach Cloudflare on every request. Processor: Cloudflare, Inc.
2. **Worker execution on `/api/*`** (`run_worker_first`). The maintainer's own code sees `CF-Connecting-IP`, `request.cf.country`, `request.cf.asn`.
3. **D1** — three stores: the daily new-games queue, edit drafts, and the audit log. **Design constraint to bake into both the schema and this policy: the audit log records GitHub login + action + target appid + timestamp, and does NOT record IP addresses.** That single decision makes the D1 section a two-sentence paragraph instead of a subject-access nightmare.
4. **Cloudflare Access on `/admin`.** Sets a `CF_Authorization` JWT cookie — the first cookie this project has ever set. It is strictly necessary for authentication, so it falls under the ePrivacy Art. 5(3) exemption: **no consent banner required**, and it is only ever set for someone who passes the Access policy (i.e. the maintainer). Cloudflare also keeps Access login audit records.
5. **Worker image transformations.** *Net privacy improvement.* Today the browser hits `shared.akamai.steamstatic.com` and `images.weserv.nl` directly, exposing visitor IPs to both. After migration the Worker fetches upstream, so Akamai sees Cloudflare's IP, and `images.weserv.nl` is removed entirely. Say this plainly — it is a genuine win and it earns credibility for the rest of the document.
6. **Data shards.** Decide and document: serve `data/*.jsonl` from the Worker's static assets rather than `raw.githubusercontent.com`. Same benefit — GitHub's CDN stops seeing anonymous visitor IPs — plus real cache headers.
7. **GitHub API** still contacted browser-side for the owner write path and the OAuth device flow. If `VITE_GH_OAUTH_PROXY` lands on the Worker, the Worker touches the OAuth exchange (never the resulting token, if built correctly — state that).
8. **Desktop / Android divergence.** `image.ts` returns direct URLs when `isTauri()`, so desktop and APK users still hit Akamai directly. Same policy covers them via the consent gate, so it needs its own subsection.
9. **Telegram bot** — unchanged, keep `:54-67` largely as-is.

### 2.3 Section outline

```
PRIVACY POLICY
  Effective date (a real ISO date + "version 2")
  Who's responsible          ← controller identity, contact, jurisdiction
  Short version              ← honest 5-bullet summary; keeps the file's voice
  What changed in v2         ← 4 lines: new domain, edge host, D1, admin cookie
  1. What the site is now    ← Cloudflare Worker + static assets, not GitHub Pages
  2. What Cloudflare sees    ← the edge paragraph; what is / isn't enabled
  3. Cookies                 ← exactly one, admin-only, strictly necessary
  4. The database (D1)       ← 3 tables, what's in them, why no visitor data
  5. Images                  ← the transformation flow, framed as an improvement
  6. What stays in your browser ← localStorage/IndexedDB/SW/sessionStorage, full key list
  7. The editing path        ← PAT, GPG key, public commits (mostly unchanged)
  8. Desktop and Android app ← the isTauri() divergence
  9. Telegram bot            ← unchanged
 10. Third parties, in one table ← Cloudflare / GitHub / Valve-Akamai / Telegram + links
 11. GDPR / UK GDPR notes    ← legal basis, processors, retention, your rights, Art. 27
 12. Children
 13. LLM / AI                ← unchanged, still true
 14. Changes + how to see the diff
 15. Contact
```

### 2.4 Key paragraphs (drop-in drafts, tone preserved)

**Who's responsible**

> This site is run by one person: **poli0981**, in Vietnam. There is no company, no team, no legal department. Contact: `lopop05905@proton.me` (checked about weekly — see [`Contact.md`](./Contact.md)). If you want the GDPR word for it: he is the *data controller*.

**What Cloudflare sees** (replaces `:9`, `:20`)

> **This is the part that changed.** The site used to be a pile of static files on GitHub Pages, and the maintainer genuinely had no server. Now `free-steam-games.win` runs on a Cloudflare Worker, which means Cloudflare's edge terminates every connection to this site. Cloudflare therefore sees, for each request: your IP address, User-Agent, the path you asked for, and the country/network Cloudflare infers from your IP. That is unavoidable for any hosted site — it is what "hosting" is — but the old policy said there was no server, and that is no longer true, so here it is in plain text.
>
> What is **not** enabled: no Cloudflare Web Analytics, no Logpush, no Analytics Engine, no custom request logging in the Worker. The maintainer does not have a searchable log of who visited. Cloudflare keeps its own aggregate zone analytics and security-event records under its own retention schedule, which he does not control and cannot query per-visitor.
>
> Still true: no Google Analytics, no Plausible, no ad tech, no fingerprinting, no third-party SDKs.

**Cookies** (replaces `:17`)

> One cookie exists, and almost certainly not for you.
>
> The `/admin` area is behind Cloudflare Access. When the maintainer signs in there, Cloudflare sets a `CF_Authorization` cookie on `free-steam-games.win`. It is an authentication token — strictly necessary, not analytics, not advertising — which is why there is no cookie banner. If you have never signed into `/admin` (you haven't; the policy is deny-by-default and lists exactly one person), no cookie is set for you.
>
> Everything else the app remembers about you lives in `localStorage`, not cookies, and never leaves your browser. See §6.

**The database**

> There is now a small Cloudflare D1 database. It holds three things, none of which is about visitors:
>
> 1. **The new-games queue** — Steam appids the pipeline found today, waiting for the maintainer to approve or reject. Game metadata only.
> 2. **Edit drafts** — half-finished edits to game records, so a closed tab doesn't lose work. Game data only.
> 3. **An audit log** — who approved what, and when. Deliberately: GitHub login, action, target appid, timestamp. **No IP addresses, no User-Agents, no visitor records.** Rows older than 180 days are deleted on a schedule.
>
> Only the maintainer can read or write any of it. Nothing a visitor does creates a row.

**Images** (new, and worth writing warmly)

> Game header images used to be loaded straight from Valve's CDN and, for larger sizes, through a third-party image proxy (`images.weserv.nl`) that the previous version of this policy never mentioned. That was a gap, and it's fixed: both of them saw your IP address.
>
> Now the images are fetched and resized at the Cloudflare edge and served from this domain. Your browser talks to `free-steam-games.win`; Cloudflare talks to Valve's CDN on its own behalf. Net effect: Valve's CDN and the third-party proxy no longer see you at all. The images themselves still belong to the game publishers — only the delivery path changed.
>
> **Exception — the desktop and Android apps.** Those load header images directly from `shared.akamai.steamstatic.com`, so Akamai does see your IP there. That's a deliberate trade (it avoids routing native-app traffic through the web edge), and it is the only place the old behaviour survives.

**Storage key list** (replaces `:39-45`)

> | Key | What | Leaves your browser? |
> |---|---|---|
> | `f2p:legal_consent` | that you accepted the terms, and which version | No |
> | `f2p:theme`, `f2p:lang` | your preferences | No |
> | `f2p:gh_token`, `f2p:gh_user` | your GitHub token + login, only if you sign in | Only to `api.github.com`, only on your action |
> | `f2p:gpg_armored` | your **encrypted** OpenPGP private key, only if you add one | No — it is decrypted in memory and wiped on lock |
> | `f2p:gpg_autolock_min`, `f2p:gpg_preferred_uid` | signing preferences | No |
> | IndexedDB `f2p:records` / `f2p:index` | the cached dataset, so reloads are instant | No |
> | Service Worker cache | app shell + last-known data, for offline | No |
> | `sessionStorage` (one flag) | prevents a reload loop after a mid-session deploy | No |
>
> **Be aware:** `f2p:gh_token` and `f2p:gpg_armored` are plain `localStorage`. Anyone with script execution on this origin, or with access to your unlocked machine, can read both. That is a deliberate trade-off for a no-backend app and it is listed as a known accepted risk in [`SECURITY.md`](../SECURITY.md). Do not paste a token or key into this app on a shared computer.
>
> "Clear site data" in your browser removes all of it.

**GDPR / UK GDPR notes** (new section — the substance)

> The maintainer is in Vietnam, but the site is reachable from the EU/UK, so GDPR Art. 3(2) may apply. Rather than pretend otherwise:
>
> - **Legal basis.** Art. 6(1)(f) legitimate interest — serving the site you asked for, and keeping it from being knocked over. For the admin cookie, Art. 6(1)(b)/(f).
> - **Processors.** **Cloudflare, Inc.** (edge, Workers, D1, Access) under its standard DPA and Standard Contractual Clauses. **GitHub, Inc.** (repository, API, Actions). **Telegram** (only if you use the bot). No one else. No data is sold, ever, to anyone, for any reason.
> - **Retention.** The maintainer holds no visitor logs at all. Cloudflare's edge records follow Cloudflare's retention, which he does not control. D1 audit rows: 180 days. Your `localStorage` lives until you clear it.
> - **Your rights.** Access, erasure, objection, portability — email `lopop05905@proton.me`. Honest caveat: for essentially every visitor, **the maintainer holds no personal data about you and no way to find any.** There are no accounts. Nothing identifies you. An erasure request would come back "there is nothing to erase" — which is the intended design, not an evasion. If you used the Telegram bot, the removable thing is your `user_id` on the local allowlist (see §9), and that request works.
> - **EU representative.** None appointed. The maintainer relies on the Art. 27(2)(a) exemption: processing is occasional, involves no special-category data, and is unlikely to result in risk to anyone. **[JUDGEMENT]** — non-lawyer assessment; assumption is that a static game directory with no accounts and no logging is exactly the case that exemption exists for. If this ever grows accounts or analytics, that assumption dies and a representative becomes necessary.
> - **Complaints.** Your local supervisory authority. Or just email him first; he'll answer faster than a regulator.

---

## 3. `docs/EULA.md` — REWRITE

### 3.1 What breaks

| Line | Claim | Problem |
|---|---|---|
| `:3` | "the entire repository — data, scripts, web app, and docs — is licensed under the MIT License" | Split. MIT for code+docs, CC BY 4.0 for data, carve-out for Valve/publisher content. |
| `:5` | "There is no installable software, no executable" | There is: Tauri desktop bundles (Win/Mac/Linux) **and** an Android APK, with an auto-updater. |
| `:5` | "the deployed Pages site" | New domain. |
| `:11` | "The MIT License governs everything… If anything in this EULA conflicts with the MIT text, the MIT text wins" | Must become a two-license precedence rule. |
| `:15` | "There is no backend, no server-side processing of your data, no account" | There is an edge, a Worker, and D1. |
| `:22` | "If you fork the repository… the MIT terms travel with you" | Data forks carry CC BY, not MIT. |

### 3.2 Section outline

```
END USER LICENSE AGREEMENT
  Short version (rewritten: two licenses, one carve-out, one operator)
  1. What you're agreeing to, and which license governs which part
  2. Nature of the work — three things now: a repo, a hosted site, and installable apps
  3. The hosted service                    ← NEW
     3.1 No SLA, may vanish
     3.2 Acceptable use (rate, /admin, no attacks) → SECURITY.md
  4. The desktop and Android apps          ← NEW
     4.1 Auto-update: what it downloads, minisign verification, how to turn it off
     4.2 Sideloading the APK is on you
  5. Your responsibilities (largely unchanged from :17-22)
  6. Maintainer's responsibilities (unchanged — "commits to nothing")
  7. Accuracy notice → DISCLAIMER.md (unchanged)
  8. Third-party content and trademarks    ← EXPANDED
     8.1 Valve / Steam marks (existing :35)
     8.2 Publisher content in the dataset — the carve-out, restated
     8.3 Header images: how they're served and the takedown route
     8.4 Bundled open-source, incl. the LGPL-3.0 notice for OpenPGP.js
  9. Contributions and the approval model  ← NEW
 10. Termination
 11. Governing law + severability + consumer-rights savings
 12. Changes
```

### 3.3 Key paragraphs

**Short version** (replaces `:3-5`)

> **Short version:** the *code* is MIT. The *dataset* is CC BY 4.0. The *game titles, descriptions, and header images inside the dataset* belong to their publishers and are not the maintainer's to license — see [`LICENSE-DATA`](../LICENSE-DATA). There is now a real website with a real operator at `https://free-steam-games.win`, plus installable desktop and Android apps. By using any of it, you're agreeing to what's below.
>
> This file is still plain-language commentary. Where it conflicts with [`LICENSE`](../LICENSE) or [`LICENSE-DATA`](../LICENSE-DATA), the license files win.

**§2 Nature of the work** (replaces `:15`)

> There are three things here, and they have different rules:
>
> 1. **The repository** — code (MIT) and data (CC BY 4.0). Fork it, host it, do what you want within those licenses.
> 2. **The website** at `free-steam-games.win` — a Cloudflare Worker the maintainer operates and pays for. This is new. The older versions of this document said "there is no backend"; there is one now, and the [Privacy Policy](./PRIVACY_POLICY.md) explains exactly what it sees.
> 3. **The apps** — a Tauri desktop build (Windows/macOS/Linux) and a sideloadable Android APK. These are real executables on your machine with a real auto-updater.

**§3.2 Acceptable use** (new)

> The site is free and stays free. In exchange, don't make it expensive:
>
> - Don't hammer it. If you want the whole dataset, take `data/*.jsonl` from GitHub — that's what it's there for, it's CC BY, and it costs the maintainer nothing.
> - Don't script the image endpoint to enumerate transformations. Cloudflare bills per unique transformation and the maintainer is, per every other document in this repo, broke.
> - Don't poke at `/admin`. It's behind Cloudflare Access and deny-by-default. Genuine security research is welcome and has its own rules — [`SECURITY.md`](../SECURITY.md) tells you how, including what's off-limits (load testing is off-limits).
> - Don't use the site to distribute malware links or to harass anyone.
>
> Consequences are unglamorous: a Cloudflare firewall rule with your ASN on it.

**§4.1 Auto-update** (new — this is a genuine EULA term the project has never had)

> The desktop app checks GitHub Releases for a newer version and can install it. The update is verified against a minisign public key baked into the app before anything runs — an update that doesn't verify is discarded. That check is the security boundary, so don't disable signature verification in a fork you then hand to other people.
>
> Turn updates off in Settings if you'd rather pin a version. You then keep the security bugs; that's the trade.

**§9 Contributions and the approval model** (new)

> Contributions land differently now. A submitted game goes into a queue in the maintainer's database, he approves or rejects it, and on approval a commit is made to the Git repository under the project's identity. Consequences, stated up front so nobody is surprised:
>
> - **Your contribution is not attributed to you** in the dataset. It's a Steam link plus facts; there's no authorship to record. This has always been the case (see [`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md) §9) — the queue just makes it explicit.
> - **By submitting, you grant:** code under MIT, data under CC BY 4.0, and you confirm you have the right to submit it — meaning you are not pasting in someone else's copyrighted text.
> - **Approval is not a review.** The maintainer clicking "approve" means the link parsed and the game is free-to-play. It does not mean anyone played it, vetted it, or vouches for it.

**§11 Governing law** (replaces `:45`)

> Vietnam, plus whatever GitHub's and Cloudflare's terms require of the maintainer. The maintainer is not a lawyer and this document is not legal advice.
>
> **Severability:** if a court where you live decides some clause here is unenforceable, that clause goes and the rest stands.
>
> **Consumer rights:** nothing here takes away rights you have by law where you live. If your country gives you rights that this document tries to disclaim, your country wins. Given the price of this service, that mostly costs the maintainer nothing.

**On `:41` ("laugh at cease-and-desist letters")** — keep the joke; the voice matters. Add one sober sentence immediately after it so it doesn't read as a refusal to handle notices:

> …and laugh at cease-and-desist letters addressed to a hobby project on a public GitHub repo.
>
> **That said, genuinely:** if you hold rights in something on this site and want it gone, email `lopop05905@proton.me` with the appid. It gets removed and added to a permanent exclusion list, usually the same week. No lawyer required, no letter required, no argument. The joke is about certified mail, not about the request.

---

## 4. `docs/ToS.md` AND `docs/DISCLAIMER.md`

### 4.1 ToS changes

| Line | Change |
|---|---|
| `:3` | "or the deployed Pages site" → define **the Repository** vs **the Service** (`free-steam-games.win`). "The MIT text governs in case of conflict" → the two-license precedence rule. |
| new §2 | **"Who runs this"** — a site operator now exists. One person, in Vietnam, paying a Cloudflare bill. He can take the Service down at any time; the Repository will outlive it. |
| new §3 | **Acceptable use of the Service** — mirror EULA §3.2, cross-reference `SECURITY.md`. |
| `:32` | "By submitting a contribution you license it under the same MIT terms" → **dual grant**: code MIT, data CC BY 4.0, plus a right-to-submit warranty ("don't paste in text you don't own — that's the one thing that can actually cause trouble here"). |
| new sub-§ under 5 | **The approval queue** — submissions enter a queue, admin approves, a commit lands. Approval ≠ review. Contributions are unattributed by design; this is already stated at `PRIVACY_POLICY.md:62` and must stay consistent. |
| `:48` | "screenshots (header images served from Akamai's `shared.akamai.steamstatic.com`)" → images are now resized and served from `free-steam-games.win`; add the takedown line. |
| `:50-52` | Forking: split it. "Fork the **code** under MIT. Redistribute the **data** under CC BY 4.0 — keep the credit line — and you inherit the carve-out: the descriptions and images in there were never the maintainer's to hand you." Keep the Ko-fi line. |
| `:60` | "The `last_updated` field in `data/index.json` is the canonical timestamp" — still true, keep. |
| `:62-64` | Add severability + consumer-rights savings (same text as EULA §11). Keep "plus common sense". |
| `:72` | "Questions: open an issue" → keep, but add: security issues do **not** go in a public issue → `SECURITY.md`. |

Everything in `:34-43` (the Telegram `user_id` rules) is good and stays verbatim. `:56` ("the maintainer can't help if your downstream project blows up") stays. `:19-24` accuracy caveats stay.

### 4.2 DISCLAIMER changes

- `:3` — keep the AS-IS paragraph verbatim; it's fine and it's load-bearing.
- `:5` and `:60` — "The MIT License … is the actual binding instrument" → "MIT for the code, CC BY 4.0 for the data, and the carve-out in `LICENSE-DATA` for the parts that were never the maintainer's."
- `:19` — **keep** "Suing the maintainer: the maintainer is broke… lives in Vietnam. Save your money." It's the single most characteristic line in the repo. Add one line beneath it: *"Rightsholders: the takedown route is `lopop05905@proton.me` and it actually works. That's cheaper than a lawyer for both of us."*
- **New caveat 8 — images are re-encoded.** "Header images are fetched from Valve's CDN, resized at our edge, and re-encoded to WebP. If one looks compressed, cropped, or stale, the original is on the Steam page. The desktop and Android apps skip this and load the original directly."
- **New caveat 9 — descriptions are excerpts.** "The `description` field is a truncated excerpt of the publisher's own store copy, cut at roughly 180 characters. It is not the full description and was never meant to substitute for the store page. Read the Steam page."
- Caveats 1–7 (`:27-46`) all still true — keep them all, verbatim.
- `:17` and `:54-56` ("Updates happen whenever the maintainer feels like it") — still true, keep. Optionally note that deploys are now automatic on push via Cloudflare Workers Builds, so the *site* updates faster than the *maintainer* does.

**Tone rule for both files, stated as a constraint for whoever implements this:** do not replace first-person voice with "the Service Provider". Do not add "WHEREAS" or all-caps blocks beyond the existing AS-IS paragraph. Do not delete the self-deprecating lines. The only places where formal language is *added* are: the license precedence rule, the takedown address, severability, and the consumer-rights savings clause — four short paragraphs total. Everything else keeps its voice.

---

## 5. `SECURITY.md` — FULL REWRITE

### 5.1 The current file's four factual errors

`SECURITY.md:4` — *"This repo is literally just a Markdown list of free-to-play Steam games + some JSON maybe later. No executable code, no dependencies, no backend, no user data."*

1. **"No executable code"** — 21 Python modules, 11 shell scripts, 23 GitHub Actions workflows, a ~200-file React SPA, a Rust/Tauri desktop app, and an Android APK.
2. **"No dependencies"** — a full npm tree with **18 open Dependabot alerts**, plus a Rust tree with `quinn-proto` (high).
3. **"No backend"** — about to be a Cloudflare Worker + D1 + Access.
4. **"No user data"** — the app stores a GitHub PAT and an armored GPG private key in `localStorage`, and the Telegram allowlist holds contributor `user_id`s.

`SECURITY.md:18` — *"email… wait, I don't have one for this"* — `lopop05905@proton.me` is published in four places: `AUTHORS.md:22`, `CONTRIBUTING.md:61`, `docs/Contact.md:37`, `web/src/pages/About.tsx:55`.

### 5.2 Outline

```
SECURITY POLICY
  Why this file is different now      ← one honest paragraph about the old version
  Supported versions                  ← table
  Reporting a vulnerability           ← private channels, ranked; NOT a public issue
  Scope — in                          ← 8 items
  Scope — out                         ← 7 items, incl. an explicit load-testing ban
  Known accepted risks                ← 4 items, stated up front
  What to expect                      ← real timelines for one person
  Safe harbour
  Rewards
  Disclosure
```

### 5.3 Draft

> # SECURITY POLICY
>
> ### Read this first
>
> The old version of this file said the repo was "just a Markdown list — no executable code, no dependencies, no backend, no user data," and then said the maintainer didn't have an email address. All five of those were wrong. This is the corrected version.
>
> This project is: a Python scraping pipeline, 23 GitHub Actions workflows, a React SPA that holds a GitHub token and an OpenPGP private key in your browser, a Cloudflare Worker with a database behind it, a signed auto-updating desktop app, and an Android APK. There is a real attack surface. Here is how to tell the maintainer about it.
>
> ### Supported versions
>
> | What | Supported |
> |---|---|
> | `https://free-steam-games.win` | Yes — whatever is currently deployed. That's the only version. |
> | Desktop app (Win/macOS/Linux) | Latest GitHub Release only. No backports. |
> | Android APK | Latest GitHub Release only. Android 11+. |
> | Dataset (`data/`) | `main` branch only. Forks and mirrors are yours. |
> | Everything older | Unsupported. Update. |
>
> ### Reporting a vulnerability
>
> **Do not open a public issue for a real vulnerability.** Public issues are the right place for a dead link or a game that went paid; they are the wrong place for "your Worker leaks the admin token."
>
> In order of preference:
>
> 1. **GitHub private vulnerability reporting** — repo → **Security** → **Report a vulnerability**. Private, threaded, and it can produce a CVE if the finding warrants one. **This is the preferred channel.**
> 2. **Email** — `lopop05905@proton.me`. Checked about weekly. Put `[SECURITY]` in the subject so it survives the archive-everything reflex described in [`docs/Contact.md`](docs/Contact.md).
> 3. **Telegram DM** — [@SkullMute0011](https://t.me/SkullMute0011), if it's urgent and you want a faster human.
>
> A useful report has: what you did, what happened, why it matters, and how to reproduce it. A screenshot of a scanner's output is not a report.
>
> ### In scope
>
> - `https://free-steam-games.win` — the Worker, its `/api/*` routes, and the static asset serving.
> - **The image transformation endpoint.** SSRF is the obvious one: if you can make the Worker fetch an origin that isn't `shared.akamai.steamstatic.com`, that's a finding.
> - **The D1 database** — the new-games queue, edit drafts, and the audit log. Anything that reads or writes it without passing Cloudflare Access.
> - **Cloudflare Access on `/admin`** — any bypass, path-confusion, or misconfiguration that gets an unauthenticated request into the admin surface.
> - **The published web bundle** — XSS, especially anything that can reach `f2p:gh_token` or `f2p:gpg_armored` in `localStorage`. This is the highest-severity class in the whole project: XSS on this origin is a full compromise of the maintainer's GitHub token *and* his signing key.
> - **The desktop and Android apps** — including the Tauri updater chain: minisign signature verification, the update endpoint, the packaged CSP.
> - **The GPG flow** — key handling, the idle auto-lock, and the commit-bytes construction in `web/src/lib/git-data.ts`.
> - **GitHub Actions** — workflow injection, secret exfiltration, anything where untrusted input (an issue body, a bot payload) reaches a shell. Reports of the form "workflow X interpolates untrusted input into `run:`" are exactly right and are wanted.
>
> ### Out of scope
>
> - **Load testing, stress testing, volumetric DoS. Explicitly forbidden.** The Worker costs money per request and the database has hard query ceilings — a flood is not a test, it's an outage, and it comes out of one person's pocket. Report the *theoretical* DoS; don't demonstrate it.
> - Game content: a game being bad, toxic, pay-to-win, or shipping kernel anti-cheat. That's the [Disclaimer](docs/DISCLAIMER.md), not a vulnerability.
> - Dead links, delisted games, wrong metadata → open a normal Bug Report issue.
> - Missing security headers, missing SPF/DMARC on a domain that sends no mail, TLS configuration opinions — unless you can show impact.
> - Raw scanner output with no proof of concept.
> - Social engineering of the maintainer, his family, or anyone else. Also, please don't.
> - Anything that first requires the maintainer's own machine to already be compromised.
> - Third-party services (GitHub, Cloudflare, Valve, Telegram) — report those to them; they have real security teams and actual bounties.
>
> ### Known accepted risks
>
> Please don't spend time rediscovering these. They're known, documented, and accepted:
>
> 1. **`f2p:gh_token` and `f2p:gpg_armored` live in plain `localStorage`.** A GitHub PAT and an armored OpenPGP private key, readable by any script on the origin. This is the cost of a no-backend app that signs its own commits. It is exactly why XSS is treated as critical here. **A concrete XSS is a valid, high-severity report; "you store a token in localStorage" is not.**
> 2. **The Tauri config currently ships no CSP** (`security.csp: null`). Being fixed. Reported and known.
> 3. **The dataset is fetched from an origin the maintainer doesn't fully control** and parsed in a Web Worker. Hardening in progress.
> 4. **Actions secrets are long-lived PATs**, and at least one is currently expired — which is the reason half the scheduled workflows are failing. Rotation is a maintainer-only operation.
>
> ### What to expect from one person
>
> No pretend enterprise SLA. Real numbers:
>
> | Stage | Target |
> |---|---|
> | Acknowledgement | **7 days** (email is checked weekly — see [`Contact.md`](docs/Contact.md)) |
> | Triage + severity | 14 days |
> | Fix, critical (token/key exfiltration, RCE in the app, Access bypass) | best effort, 30 days |
> | Fix, everything else | when it's fixed. Honestly. |
> | No response after 14 days | ping again, or try a different channel — it's inattention, not a policy |
>
> ### Safe harbour
>
> Good-faith research within the scope above will not be pursued, reported, or complained about. Stay inside scope, don't touch other people's data, don't degrade the service for anyone else, and give the maintainer a reasonable window before publishing.
>
> ### Rewards
>
> None. No bounty, no swag, no money — the older version of this file was right about that one thing. What's on offer: credit in [`ACKNOWLEDGEMENTs.md`](docs/ACKNOWLEDGEMENTs.md) if you want it, coordinated disclosure, and genuine gratitude.
>
> ### Disclosure
>
> Coordinated. 90 days from acknowledgement, or when a fix ships, whichever is first. If it's actively exploited, tell the maintainer and publish whenever you need to — user safety beats his schedule.

---

## 6. CONTRADICTION-FIX TABLE

Every row verified against the working tree.

### 6.1 Counts and inventories

| # | File:line | Wrong | Correct |
|---|---|---|---|
| 1 | `README.md:1` | badge `Games-1.2k%2B` | `Games-3,424` — better: a shields.io dynamic-JSON badge reading `data/index.json` `$.total`, so it can never drift again |
| 2 | `README.md:12` | "now ~1,200 of them" | "now ~3,400 of them" |
| 3 | `README.md:16` | "virtualised 1.2k-row table" | "virtualised 3.4k-row table" |
| 4 | `README.md:35` | Raw data = `data_001.jsonl` + `data_002.jsonl` | `data_001` … `data_005` (5 shards, 5.9 MB) |
| 5 | `README.md:48` | "virtualised 1.2k-row table" (details block) | 3.4k-row |
| 6 | `README.md:89` | "cap 800 records/shard, current total ~1,230" | "cap 800/shard, current total 3,424 across 5 shards" |
| 7 | `README.md:103-106` | tree shows `data_001 # ≤800` / `data_002 # the rest` | `data_001..005.jsonl` |
| 8 | `README.md:130` | ".github/workflows/ # 11 workflows: data pipeline + Pages + desktop release" | "# 22 workflows: data pipeline + release + notifications + CodeQL" (23 today, minus `deploy-pages.yml` after migration) |
| 9 | `README.md:156` | `migrate_schema.py # Upgrade old records to v2.1` | **Does not exist.** Delete the line. |
| 10 | `README.md:157` | `export_data.py # CSV export` | **Does not exist.** Delete. (CSV export is a web-app feature, not a script.) |
| 11 | `README.md:148-158` | scripts list omits 5 | Add `top_offline.py`, `mark_dead_games.py`, `generate_anti_cheat_list.py`, `normalize_genres.py`, `snapshot.py` |
| 12 | `README.md:165-181` | workflow table has 15 rows; 8 workflows absent | Add: **Anti-Cheat List** (`anti-cheat-list.yml`, cron `0 6 * * 0`), **CodeQL** (`codeql.yml`, push), **Notify CI Failures**, **Notify Deploy Status**, **Notify Release Pipeline** (all `workflow_run`), **Announce Release to Discord** (`announce-release.yml`, on release), **Release Android App** (`release-android.yml`, push tag), **Daily Snapshot** (`snapshot-daily.yml`, cron `0 23 * * *`) |
| 13 | `README.md:178` | "**Deploy Web** — Build + deploy SPA to GitHub Pages" | **Delete the row** — `deploy-pages.yml` is removed. Replace with a "Deployment" line: Cloudflare Workers Builds, Git-integration, no workflow file |
| 14 | `README.md:97` and `README.md:136` | **two `<summary><b>Architecture</b></summary>` blocks** with different, partly-contradictory trees | Collapse into one, or move both into the new `ARCHITECTURE.md` and leave a link |
| 15 | `web/README.md:9` | "TanStack Virtual (1,200+ row table)" | 3,424-row |
| 16 | `web/README.md:140` | "The 9 existing workflows" | 22 |
| 17 | `docs/ACKNOWLEDGEMENTs.md:59` | "TanStack Virtual — 1.2k-row virtualised table" | 3.4k-row |
| 18 | `web/src/pages/About.tsx:77` | "1.2k-row virtualised table" | 3.4k-row |
| 19 | `games/README.md:3` | "**3424 games** · 2026-08-13" — *correct*, but generated from a stale run vs `index.json` `last_updated: 2026-09-07` | Regenerate after the pipeline is fixed; add the license footer at the same time |

### 6.2 Toolchain versions

| # | File:line | Wrong | Correct |
|---|---|---|---|
| 20 | `README.md:222` | "Python 3.12 / Node ≥ 22" | CI spans **Python 3.11 / 3.12 / 3.14** and **Node 24**. Either unify CI on one Python and state it, or say "Python 3.12 locally; CI matrix varies — see workflows" |
| 21 | `AUTHORS.md:34` | "Python 3.12 · Node.js ≥ 22" | same |
| 22 | `docs/dev_env.md:19-20` | table rows "Python 3.12" / "Node.js ≥ 22 (LTS)" | Python as unified; **Node 24** |
| 23 | `docs/dev_env.md:26` | "The CI workflows in `.github/workflows/` **pin these versions explicitly**" | They pin *three different* Python versions. Either fix CI first (recommended, and it's another agent's lane) or rewrite this to "CI pins per-workflow; the canonical version is X" |
| 24 | `docs/dev_env.md:26` | links `deploy-pages.yml` "for the web deploy" | File is deleted. Link `docs/DEPLOYMENT.md` |
| 25 | `docs/i18n/vi/dev_env.md:19-20` | same 3.12 / ≥22 | mirror the EN fix |
| 26 | `web/src-tauri/TAURI.md` prereq table | "Node.js ≥ 22 (LTS)" | Node 24 |

### 6.3 Repo hygiene

| # | File:line | Wrong | Correct |
|---|---|---|---|
| 27 | `.gitignore:120-125` | block headed `# F2P Tracker desktop app (Electron + Vite)` ignoring `app/dist/`, `app/dist-electron/`, `app/release/`, `app/.vite/`, `app/*.tsbuildinfo` | **No `app/` directory exists and the desktop app is Tauri, not Electron.** Replace with `# Tauri desktop + Android (web/src-tauri)` and `web/src-tauri/target/`, `web/src-tauri/gen/`, `web/src-tauri/WixTools/` |
| 28 | `username.txt:10` | "telegram bot: @my_skull_bot or QR (in \`assets/qr\`, **file untracked**)" | **Tracked.** `git ls-files assets/` returns `assets/qr/telegram-bot.png` and `assets/qr/telegram-user.png`. Drop "file untracked" |
| 29 | `.gitattributes:4` | `/tests/ export-ignore` | No `tests/` directory exists. Remove the line (or create the directory — `CONTRIBUTING.md:108` admits there is no test suite) |
| 30 | `.gitattributes:15-22` | `export-ignore` on `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `docs/Contact.md`, `docs/PRIVACY_POLICY.md`, `docs/ToS.md` | After the license split this strips the licensing table and both legal docs out of every source archive. Remove at minimum `README.md`, `docs/ToS.md`, `docs/PRIVACY_POLICY.md`, `SECURITY.md` |
| 31 | `.github/workflows/bot-ingest.yml` header comment | names the wrong repository | Name `poli0981/free-steam-games-list`, and note the bot source lives at `poli0981/telegram-scraper-bot` |
| 32 | `.github/workflows/codeql.yml` | path filters reference `webapp/**` | No such directory. Use `web/**` and `scripts/**` |
| 33 | `SECURITY.md:4` | 4 false claims | §5 |
| 34 | `SECURITY.md:18` | "I don't have one" (email) | `lopop05905@proton.me` — published at `AUTHORS.md:22`, `CONTRIBUTING.md:61`, `docs/Contact.md:37`, `About.tsx:55` |

### 6.4 URLs → `https://free-steam-games.win`

All hash-routes (`#/about`, `#/games`) also become clean paths under BrowserRouter.

| # | File:line | Current |
|---|---|---|
| 35 | `README.md:5` | Web App badge → `poli0981.github.io/free-steam-games-list/` |
| 36 | `README.md:12`, `:28`, `:44` | prose + Quick-links row + details summary |
| 37 | `README.md:37` | `.../#/about` → `https://free-steam-games.win/about` |
| 38 | `README.md:60` | "rebuilt and re-deployed automatically on every commit to `data/**` or `web/**`" → Cloudflare Workers Builds, per its watch paths |
| 39 | `CONTRIBUTING.md:9` | `.../#/about` |
| 40 | `CONTRIBUTING.md:41` | "Open `https://poli0981.github.io/...`" |
| 41 | `AUTHORS.md:3` | About-page link |
| 42 | `docs/PRIVACY_POLICY.md:7` | site URL |
| 43 | `web/README.md:3`, `:30`, `:62`, `:70`, `:132-136` | Pages hosting, `raw.githubusercontent` read path, `base` path, deploy section |
| 44 | `games/README.md:34` | `#/games` — **generated**; fix the source at `scripts/generate_tables.py:193` |
| 45 | `web/index.html:21` | `<link rel="canonical">` |
| 46 | `web/index.html:31` | `og:url` |
| 47 | `web/index.html:59` | JSON-LD `description` + `@id` `#website` |
| 48 | `web/index.html:17`, `:26`, `:29`, `:41`, `:59` | **"1,200+"** in meta description, `og:title`, `og:description`, `twitter:title`, JSON-LD → 3,400+ |
| 49 | `web/index.html:17` | meta description says "Open-source, **MIT-licensed**" | "Code MIT, data CC BY 4.0" |
| 50 | `web/src/lib/oauth-device.ts` | github.io URL in the device-flow copy |
| 51 | `.github/workflows/release-desktop.yml`, `release-android.yml` | release-notes text points at Pages |
| 52 | `.github/ISSUE_TEMPLATE/bug_report.yml` (2 places) | permalink format `.../#/games/{appid}` → `https://free-steam-games.win/games/{appid}` |
| — | `CHANGELOG.md` (many) | **Leave alone** — historical record; the URL was correct when written |
| — | `games/all-games_*.md` | Regenerated; fixed by #44 |

### 6.5 Licensing claims

| # | File:line | Wrong | Correct |
|---|---|---|---|
| 53 | `AUTHORS.md:56` | "Everything in this repo (data, code, docs, web app) is MIT-licensed" | Code + docs MIT; data CC BY 4.0; third-party carve-out |
| 54 | `web/src/pages/About.tsx:140` | "…this web app sits on top of the same data shards. MIT licensed." | split |
| 55 | `web/src/pages/About.tsx:450-459` | "The whole repo (data, code, docs, this web app) is MIT-licensed" | split; render both license links |
| 56 | `docs/EULA.md:3` | "the entire repository — data, scripts, web app, and docs — is licensed under the MIT License" | §3 |
| 57 | `docs/DISCLAIMER.md:5`, `:60` | "The MIT License … is the actual binding instrument" | §4.2 |
| 58 | `docs/ToS.md:3`, `:32`, `:52` | MIT everywhere | §4.1 |
| 59 | `docs/PRIVACY_POLICY.md:62` | "previously-ingested games stay in the dataset **under MIT licence**" | "…under the dataset's CC BY 4.0 licence" |
| 60 | `web/src/lib/legal.ts:20` | label `"MIT License"`, hint "the actual binding terms" | Two entries: "License — Code (MIT)" and "License — Data (CC BY 4.0)" |
| 61 | `web/src/lib/legal.ts:24` | Privacy hint "no data collected by the site itself" | **Becomes false.** → "what the site, the edge, and the apps can see" |
| 62 | `docs/ACKNOWLEDGEMENTs.md:8` | "GitHub — for free hosting (data, **Pages**, Actions, Releases)" | Drop Pages; add Cloudflare to the thanks list |
| 63 | `docs/THIRD_PARTY.md` | no LGPL-3.0 notice for OpenPGP.js 6.3.0 | §1.5 — new `docs/OSS_NOTICES.md` |

### 6.6 Privacy accuracy (pre-existing, not migration-caused)

| # | File:line | Wrong | Correct |
|---|---|---|---|
| 64 | `docs/PRIVACY_POLICY.md:25-31` | outbound endpoint list omits `images.weserv.nl` | `web/src/lib/image.ts` `preferWebp()` routes every large image through it today. **Undisclosed third-party processor seeing visitor IPs.** Disclose it now; it disappears at migration |
| 65 | `docs/PRIVACY_POLICY.md:39` | "three local-storage mechanisms" | Four — add `sessionStorage` (`web/src/lib/lazy.ts` chunk-reload flag) |
| 66 | `docs/PRIVACY_POLICY.md:41` | "your selected GPG key (encrypted by the key's own passphrase)" | The **armored private key** is in `f2p:gpg_armored`; the list omits `f2p:gh_user`, `f2p:gpg_autolock_min`, `f2p:gpg_preferred_uid`, `f2p:legal_consent`. Use the full table in §2.4 |
| 67 | `README.md:9` | `visitor-badge.laobi.icu` hotlinked, disclosed nowhere | Minor — GitHub's camo proxy shields the reader's IP, so impact is low. Either drop the badge or mention it in the Privacy Policy's third-party table for completeness |

---

## 7. DOCS TO CREATE

### 7.1 `docs/DEPLOYMENT.md` — Cloudflare runbook

```
# Deployment — Cloudflare Workers
  What replaced what          ← GitHub Pages → Worker + Static Assets; deploy-pages.yml deleted
  1. Prerequisites            ← Cloudflare account, Workers Paid, domain on Cloudflare
  2. DNS
     2.1 free-steam-games.win records — apex + www, proxied
     2.2 VERIFY FIRST: the domain does not currently resolve from a clean
         resolver (no A/AAAA found). Confirm zone activation and nameserver
         delegation before anything else. Include the exact dig commands and
         the expected output.
  3. wrangler.jsonc — the only deploy config
     name / compatibility_date / main
     assets: { directory, binding: "ASSETS",
               not_found_handling: "single-page-application",
               run_worker_first: ["/api/*"] }
     d1_databases binding
     Annotated field-by-field; call out that a matching static file is
     served WITHOUT invoking Worker code
  4. Workers Builds (Git integration)
     Root directory, build command, deploy command, build watch paths
     Why there is NO deploy workflow in .github/workflows
  5. Environments             ← production vs preview; preview URLs are public
  6. Secrets and bindings     ← wrangler secret put; what must never be a var
  7. D1
     7.1 Schema + migrations (queue / drafts / audit_log)
     7.2 Free-tier ceilings: 5M reads/day, 100K writes/day, 5 GB.
         Since 2026-09-01 over-limit queries HARD FAIL on Free — this is an
         availability cliff, not throttling. State the plan explicitly.
     7.3 Backup + restore
     7.4 The 180-day audit-log prune job
  8. Images
     8.1 fetch(url, { cf: { image: {...} } })
     8.2 Source-origin allowlist — shared.akamai.steamstatic.com only.
         SSRF prevention AND the §1.4 legal constraint, same rule.
     8.3 COST: 5,000 unique transformations/month free, then a separate
         Images plan at $0.50/1,000. 3,424 games × ~2 sizes ≈ 6,800 unique
         transformations on the first full crawl — the free tier is blown
         on day one. Decide: pay, cache aggressively, or pre-generate.
         This is the single biggest cost surprise in the migration.
  9. Cloudflare Access on /admin
     App definition, path precedence (most-specific first), deny-by-default,
     the CF_Authorization cookie, and the break-glass procedure
 10. Caching                  ← asset immutability, data/*.jsonl TTL vs
                                index.json.last_updated as the invalidation signal
 11. Rollback                 ← previous deployment, and how to roll back a D1 migration
 12. Verification checklist   ← 12 things to curl/check after a deploy
 13. Cost model               ← Workers Pro + Images + D1, monthly estimate
```

### 7.2 `docs/ADMIN.md` — admin operations

```
# Admin operations
  Who this is for             ← one person. If that changes, so does Access.
  1. Getting in               ← Access sign-in, session lifetime, lockout recovery
  2. The daily loop           ← queue → review → approve/reject → commit
  3. The new-games queue      ← where rows come from, what a row means,
                                what "approve" actually commits
  4. Edit drafts              ← lifecycle, conflicts, discarding
  5. The audit log            ← what's recorded, what's deliberately not (no IPs),
                                retention, how to read it
  6. The Git write path       ← blob→tree→commit→update-ref, GPG signing,
                                the mandatory index.json.last_updated bump,
                                conflict retry
  7. Manual field discipline  ← MANUAL_FIELDS are never overwritten by refetch;
                                which ones and why
  8. Secrets rotation         ← GH_TOKEN PAT (CURRENTLY EXPIRED — this is why the
                                scheduled workflows fail), Cloudflare API token,
                                the minisign updater key, the GPG key.
                                Rotation cadence + the exact steps for each.
  9. Takedown procedure       ← rightsholder email → find appid → remove
                                description/header_image → add to the permanent
                                exclusion list → confirm. Target: same week.
                                This is a LEGAL commitment made in EULA §8 and
                                DISCLAIMER; it needs a real runbook behind it.
 10. Incident response        ← a security report arrives: triage, containment,
                                what to revoke first (token, then key, then Access)
 11. When things break        ← workflow failed / D1 over quota / images 402 /
                                deploy stuck / DNS regression
```

### 7.3 `docs/DATA_LICENSE_FAQ.md`

```
# Data license — FAQ
  Can I use this dataset? — yes, CC BY 4.0, here's the credit line
  What exactly is CC BY 4.0 covering, and what isn't it?
  Why is the description field carved out?
  Why are descriptions truncated? (they weren't always)
  Can I redistribute the header images?    ← no; here's what you can do
  Can I use this commercially?             ← yes, with attribution + the carve-out
  Do I have to share my changes?           ← no; this is not ODbL, deliberately
  Is there an EU database right here?      ← no, and why (maker not in the EEA)
  Am I allowed to scrape Steam myself?     ← not our call; Valve's terms are Valve's
  I'm a publisher and I want my game's text/image removed  ← the takedown route
  I'm building a competing tracker         ← go ahead, that's the point
  How do I cite this in a paper?           ← BibTeX + a versioned snapshot note
  What about the code?                     ← MIT, different file, different rules
  Which license applies to games/*.md?     ← CC BY 4.0, it's derived data
```

### 7.4 `ARCHITECTURE.md` (repo root)

```
# Architecture
  One-paragraph summary + a system diagram
  1. The shape of the thing   ← Git is canonical; D1 is workflow state; the
                                Worker is delivery. Say this in three sentences
                                because it is the single most important fact.
  2. Data
     2.1 Record schema        ← 27 fields; appid is NOT stored, it's parsed from
                                `link` via /\/app\/(\d+)/; numeric-looking fields
                                are FORMATTED STRINGS ("492,197")
     2.2 Sharding + index.json (800/shard, 5 shards, 3,424)
     2.3 MANUAL_FIELDS and the never-overwrite rule
     2.4 The schema.ts ↔ constants.py mirror contract
  3. The pipeline             ← 14 scripts, 6 core modules, 22 workflows,
                                what triggers what, the concurrency group
  4. The web app              ← Vite/React/TS, routes, the Web Worker JSONL parse,
                                IndexedDB cache keyed on index.last_updated,
                                the service worker
  5. The edge                 ← Worker, static assets, /api/*, image transforms
  6. The database             ← the 3 D1 tables, and why they are NOT the
                                source of truth
  7. The write path           ← the full blob→tree→commit→sign→update-ref chain
                                and the last_updated invalidation signal
  8. Auth                     ← useIsOwner, PAT vs OAuth device flow, Cloudflare
                                Access, and the fact that there is no backend
                                session anywhere
  9. Native shells            ← Tauri desktop + Android, the updater chain,
                                where behaviour diverges from web (images, CSP)
 10. Trust boundaries         ← a table: what crosses which boundary, and what
                                validates it. Feeds SECURITY.md scope directly.
 11. Known weirdness          ← the honest list, in the repo's voice
```

Fold `README.md:97-161`'s two duplicate Architecture blocks into this file and leave one link behind (contradiction #14).

### 7.5 `web/src/lib/legal.ts` — render in-app at `/legal/*`

**Yes, change it.** Three reasons:

1. **The current flow is a bad consent flow.** `ConsentGate.tsx:86` calls `openExternal(legalDocUrl(d.path))`. On Tauri desktop and Android that *ejects the user into a system browser* to read the terms they are being asked to accept, then expects them to come back. That undermines the "informed" half of informed consent for the exact surface where it matters most.
2. **A Privacy Policy needs a citable URL on the service's own domain.** `https://free-steam-games.win/legal/privacy` is a privacy policy. `https://github.com/.../blob/main/docs/PRIVACY_POLICY.md` is a file in a repo. Now that a site operator exists, the former is what's expected.
3. BrowserRouter makes `/legal/*` real, shareable, indexable URLs.

**Shape:**

```ts
export interface LegalDoc {
  label: string;
  path: string;          // repo-relative, still the single source of truth
  route: string;         // NEW: "/legal/privacy"
  hint: string;
  consent?: boolean;
}

export function legalRoute(doc: LegalDoc): string      // in-app
export function legalSourceUrl(path: string): string   // GitHub blob — keep it,
                                                        // shown as "view source / history"
```

Implementation: import the markdown at build time with Vite's `?raw`, render with a minimal sanitizing markdown renderer. ~35 KB of prose total — negligible, and it keeps `docs/*.md` as the one source of truth (no duplicated legal text, which is the failure mode to avoid).

**Bundle constraint:** `ConsentGate.tsx:11-14` documents that the gate is deliberately in the *eager* bundle so it paints with no flash. Do not pull the legal renderer into that bundle. Make `/legal/*` a lazy route; the gate's links navigate to it and pay a chunk load on click. That's fine — it's a click, not first paint.

**Critical companion change:** `ConsentGate.tsx:30` currently only bypasses `/error/*`. It **must** also bypass `/legal/*`, or the documents the gate asks you to read sit behind the gate itself. That is a genuine circular lock and it will ship if nobody writes it down:

```ts
const isBypass = location.pathname.startsWith("/error")
              || location.pathname.startsWith("/legal");
```

Also update `About.tsx:462-479`, which builds its own `${REPO_URL}/blob/main/${d.path}` links — route those through `legalRoute()` too, with `legalSourceUrl()` as a secondary "view on GitHub" affordance.

### 7.6 Do the `docs/i18n/vi/` mirrors expand?

Currently three mirrors: `android-support.md`, `dev_env.md`, `pc_spec.md` — all developer docs.

**Recommendation: mostly no, with one addition.**

- **Do NOT translate the legal documents.** `web/README.md:108` and `legal.ts:5-8` both record this as a deliberate policy, and the reasoning holds and strengthens: two texts drift, and a Vietnamese translation of a privacy policy authored by a Vietnam-resident controller could plausibly be argued to be *the operative one*, which doubles the maintenance obligation for one person. **[JUDGEMENT]** Assumption: English-only legal text with a clear pointer is standard practice and acceptable.
- **Do NOT mirror the new operational docs** (`DEPLOYMENT.md`, `ADMIN.md`, `ARCHITECTURE.md`). Audience is one bilingual person. Pure maintenance cost.
- **DO add one new Vietnamese doc:** `docs/i18n/vi/TOM_TAT_PHAP_LY.md` — a one-page, explicitly **non-binding** Vietnamese summary of the six consent documents, ending with "bản tiếng Anh là bản có hiệu lực" (the English version is the operative one) and links to each. Rationale: `web/index.html:2` hardcodes `lang="vi"`, Vietnamese is a first-class UI language, and a consent gate whose six linked documents are all English-only is a real usability gap for the project's likely-largest audience. A clearly-labelled summary carries none of the drift risk of a translated instrument.
- **DO** mirror the toolchain-version fixes into `docs/i18n/vi/dev_env.md:19-20` (contradiction #25).

---

## 8. THE CONSENT GATE

### 8.1 `TERMS_VERSION` — bump 1 → 2

`web/src/stores/consent.ts:15`. This is not optional. Three independently sufficient reasons:

1. **The license under which the user receives the data changes** — MIT → CC BY 4.0, with a new third-party carve-out.
2. **A site operator appears.** The service moves from GitHub's infrastructure to infrastructure the maintainer runs and pays for, on a new domain.
3. **The Privacy Policy inverts its central claim** — from "there is no server" to "there is an edge, a database, and a cookie."

The comment at `consent.ts:12-14` already states the rule ("Bump this whenever the binding legal documents change materially"). This is the textbook case.

### 8.2 `CONSENT_DOCS` — 5 → 6

`web/src/lib/legal.ts:19-30`:

```ts
export const LEGAL_DOCS: LegalDoc[] = [
  { label: "License — Code (MIT)",        path: "LICENSE",                 route: "/legal/license-code", hint: "MIT — the code, the docs, the workflows", consent: true },
  { label: "License — Data (CC BY 4.0)",  path: "LICENSE-DATA",            route: "/legal/license-data", hint: "the dataset, plus what isn't ours to license", consent: true },
  { label: "Disclaimer",                  path: "docs/DISCLAIMER.md",      route: "/legal/disclaimer",   hint: "no warranty, accuracy caveats, liability shrug", consent: true },
  { label: "Terms of Use",                path: "docs/ToS.md",             route: "/legal/terms",        hint: "what you agree to by using the site", consent: true },
  { label: "EULA",                        path: "docs/EULA.md",            route: "/legal/eula",         hint: "covers the site and the installable apps", consent: true },
  { label: "Privacy Policy",              path: "docs/PRIVACY_POLICY.md",  route: "/legal/privacy",      hint: "what the site, the edge, and the apps can see", consent: true },
  { label: "Data license FAQ",            path: "docs/DATA_LICENSE_FAQ.md",route: "/legal/data-faq",     hint: "can I use this dataset? (yes, with credit)" },
  { label: "Security policy",             path: "SECURITY.md",             route: "/legal/security",     hint: "how to report a vulnerability" },
  { label: "Open-source notices",         path: "docs/OSS_NOTICES.md",     route: "/legal/notices",      hint: "third-party licenses, incl. LGPL" },
  { label: "Acknowledgements",            path: "docs/ACKNOWLEDGEMENTs.md",route: "/legal/credits",      hint: "credits to AI assistants + contributors" },
  { label: "Contact",                     path: "docs/Contact.md",         route: "/legal/contact",      hint: "where to find me" },
];
```

Note `legal.ts:24`'s existing hint — "no data collected by the site itself" — is one of the false claims and it renders *in the consent gate UI itself*. Fix it in the same change as the policy.

### 8.3 Show what changed

A returning user hit by the v2 bump gets re-prompted with no explanation, which reads as a bug. Add to the gate a one-line "what changed" block:

```ts
export const TERMS_CHANGE_SUMMARY = {
  2: "New home at free-steam-games.win, a real server behind it, and the dataset is now CC BY 4.0 instead of MIT.",
} as const;
```

Render it above the checkbox when `stored?.version` exists and is lower than `TERMS_VERSION` (the store currently discards the old version — keep it in state to distinguish *first run* from *re-consent*). Two-line change in `consent.ts`, meaningful trust improvement.

### 8.4 Route bypass — the blocking bug

`ConsentGate.tsx:30` — see §7.5. `/legal/*` must join `/error/*` in the bypass, or the consent documents become unreachable from the consent gate once they render in-app.

### 8.5 Interaction with the new welcome page

**Order: consent gate → welcome → dashboard.** Not the other way around.

Rationale: the welcome page is product onboarding, not a legal instrument. Showing it first means the user has meaningfully *used* the service before accepting anything. Consent first is both cleaner legally and simpler to reason about.

**Use a separate storage key.** `f2p:welcome_seen` — a plain boolean with **no version number**, deliberately decoupled from `f2p:legal_consent`. Consequence: a future `TERMS_VERSION` bump re-prompts consent **without** dragging a returning user back through onboarding they've already seen. Coupling them would make every legal update feel like a factory reset.

**Do not fold welcome into the gate.** `ConsentGate.tsx:11-14` documents that the gate lives in the eager bundle specifically to paint on first render with no flash. A marketing/onboarding page belongs on a lazy route; putting it in the eager bundle regresses first paint for every returning visitor.

Suggested placement in `App.tsx`: a `<WelcomeGate>` between `<ConsentGate>` and the router outlet, or simply a redirect on the `/` route when `!welcomeSeen`. The second is cheaper and keeps `/welcome` a real shareable URL.

**Content the welcome page should carry** (cheap, and it earns its place legally):
- What this is, in one sentence, and the real count (3,424 — pulled live from `index.json`, never hardcoded, which is how contradictions #1–#7 happened in the first place).
- "Not affiliated with Valve" — one line, satisfies the nominative-use hygiene the EULA claims.
- The CC BY credit line, copy-to-clipboard. Free attribution compliance from anyone who reuses the data.
- Links: browse, charts, the dataset on GitHub, the license pair.

### 8.6 Two properties worth documenting explicitly

- **Consent is stored client-side only** and there is deliberately **no server-side record**. Writing consent records to D1 would create a new personal-data store to solve a problem nobody has. State this in the Privacy Policy — it is a genuinely good fact and it costs nothing to say.
- **The gate is an acceptance record, not access control.** Anyone can clear `localStorage`. That is fine and intended; say so in `ADMIN.md` so nobody later mistakes it for a security boundary.
- **Tauri decline behaviour** (`ConsentGate.tsx:34-50`, closes the window) stays as-is. It is the right behaviour for an installed app and the right asymmetry versus the web's soft-block at `:52-69`.

---

## APPENDIX — cross-lane handoffs

Things I found in this lane that belong to other agents' lanes:

- **`.gitattributes:15-22`** strips README + ToS + Privacy from `git archive` output — a licensing problem that lives in a repo-config file.
- **`web/src/lib/git-data.ts`** must preserve the three new `data/index.json` license keys when it rewrites the manifest to bump `last_updated`, rather than reconstructing the object.
- **`scripts/core/fetcher.py`** is where description truncation belongs — one place, covers API/scraper/extension/bot paths. Not `data_store.py`'s merge path (risk of double-truncation on re-shard).
- **Image-transformation cost**: ~6,800 unique transformations on the first full crawl vs a 5,000/month free allowance. This is a budget decision, not a docs decision, but no other lane's brief flags it.
- **The `description` truncation is a ~3,424-record rewrite** — it needs to land in one deliberate commit with the `concurrency: { group: data-write }` guard held, and `snapshot-daily.yml` is currently missing that guard.