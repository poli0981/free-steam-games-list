# Changelog

All notable changes to this awesome noob repo will be documented here.

## [v3.2.1] – 2026-05-11 (The "Genre Cleanup" Edition)

Patch release on top of v3.2.0. Normalizes inconsistent `genre` values across the dataset (31 records, 10 canonical mappings) and broadens the webapp's genre combobox with 14 additional suggestions. Web app + desktop bumped `1.2.0` → `1.2.1`. Repo public-facing version `3.2.0` → `3.2.1`. Tag `v3.2.1` is GPG-signed; companion desktop tag is `desktop-v1.2.1`.

### 🧹 Genre normalization script

- New `scripts/normalize_genres.py` — local one-shot tool with `--apply` flag (dry-run by default). Reuses `core.data_store.load_main` / `save_main` so writes are atomic + sharded.
- Canonical mappings applied (sentence-case style for compounds): `Hack and Slash` → `Hack & Slash` (4), `Third-Person Shooter` → `Third-person Shooter` (7), `Top-Down Shooter` → `Top-down Shooter` (3), `Turn-Based Strategy` → `Turn-based Strategy` (3), `Turn-Based Tactics` → `Turn-based Tactics` (4), `Turn-Based Combat` → `Turn-based Combat` (2), `Shoot 'Em Up` / `Shoot'em up` → `Shoot 'em up` (5), `Point-and-Click` → `Point & Click` (1), `Rougelite` → `Roguelite` (2 typo).
- 31 records updated · 10 unique canonical changes · unique-genre count 100 → 92.
- Idempotent — second run reports "data already canonical".
- Comma-separated values like `"Action RPG, Gacha"` (Wuthering Waves, Honkai Impact 3rd) are flagged in a "Manual review needed" section rather than auto-split, since the schema is single-genre.
- All `games/*.md` regenerated via `scripts/generate_tables.py`; affected genre files include the new sentence-case slugs (`turn-based-strategy.md`, `top-down-shooter.md`, `third-person-shooter.md`, `roguelite.md`, etc.).

### 🎛 Webapp genre dropdown additions

- `web/src/lib/enums.ts` — `GENRE_ENUM` extended from 44 → 58 entries. Added 14 sub-genres already common in the data: `Action RPG`, `Beat 'em up`, `Bullet Hell`, `Clicker`, `Hidden Object`, `Real-Time Strategy`, `Roguelite`, `Survival Horror`, `Tactical RPG`, `Third-person Shooter`, `Top-down Shooter`, `Turn-based RPG`, `Turn-based Strategy`, `Turn-based Tactics`.
- Sentence-case style matches the normalized data values.
- Dropdown filter on `web/src/pages/Games.tsx` is facet-driven (auto-updates from the records), so it now shows the deduplicated canonical names. The `EditGameDrawer` combobox suggests the 14 new entries while still accepting free-text input.

## [v3.2.0] – 2026-05-11 (The "SEO + Donate + Auto-Discussion + Health Polish + Dev Docs" Edition)

Single-PR bundle (#64) shipping eight features on top of v3.1.0. Web app + desktop bumped from `1.1.0` → `1.2.0`. Repo public-facing version `3.1.0` → `3.2.0`. Tag `v3.2.0` is GPG-signed; companion desktop tag is `desktop-v1.2.0`.

### 🔍 SEO basics

- `web/index.html` — full Open Graph block (`og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:site_name`, `og:locale` + alternate), Twitter Card (`summary`), `<link rel="canonical">`, `meta name="author"`, JSON-LD (`WebSite` + `Person` + `SoftwareApplication`).
- New `web/public/robots.txt` (allow all + sitemap pointer) and `web/public/sitemap.xml` (5 entries: site root, GitHub repo, all-games / top-online / changelog markdown).
- New hook `web/src/hooks/useDocumentTitle.ts` — sets `document.title` to `<page> · Steam F2P Tracker` and re-runs on language change. Wired into all 18 routes (Dashboard / Games / TopOnline / Health / Activity / Add / About / Donate / Settings / 9 charts).
- VitePWA already emits `manifest.webmanifest` from `vite.config.ts`; no manual manifest needed.

### 💬 Auto-create GitHub Discussion on release

- New `.github/workflows/announce-release-discussion.yml` — fires on `release: published` (plus `workflow_dispatch` with a `tag` input for re-runs).
- Implemented via `actions/github-script@v8` + GraphQL `createDiscussion` (REST has no equivalent).
- Resolves the discussion category by slug — defaults to `Announcements`, falls back to `General` with a logged warning, then to the first available category.
- **Idempotent**: a GraphQL search runs first; if a discussion with the same title exists, the workflow skips with `core.notice()` and returns the existing URL via output. Re-running `workflow_dispatch` is therefore a no-op.
- Permissions: `contents: read`, `discussions: write` — both granted by `GITHUB_TOKEN` defaults once Discussions is enabled on the repo.

### 💖 Donate page

- New `web/src/pages/Donate.tsx` route at `/donate` — grid of 5 platform cards (GitHub Sponsors, Ko-fi, Buy Me a Coffee, Patreon, PayPal) sourced from `.github/FUNDING.yml`.
- Each card has a tinted icon ring, label, short description, and an "Open" button (`target="_blank" rel="noopener noreferrer"`).
- New nav item in `web/src/components/layout/Sidebar.tsx` SECONDARY group (between About and Settings); `Heart` icon from lucide.
- Full EN + VI i18n keys under `donate.*` (title / subtitle / cta / footnote + per-platform label & desc).

### 📖 Dev docs

- New `docs/pc_spec.md` (EN) + `docs/i18n/vi/pc_spec.md` (VI) — maintainer hardware spec mirroring `E:\spec.txt` (CPU / GPU / RAM / IDE) plus iPhone test-device list.
- New `docs/dev_env.md` (EN) + `docs/i18n/vi/dev_env.md` (VI) — IDE map (PyCharm / WebStorm / RustRover 2026.x), toolchain table (Python 3.12 / Node ≥ 22 / Rust stable / Tauri 2), per-area dev workflow (web / Tauri / Python pipeline), Git + GPG conventions, branch + PR flow.
- New `web/src-tauri/TAURI.md` — desktop build prerequisites (incl. CI's exact `apt-get` line), local + production build commands, signing + auto-update notes, troubleshooting.
- `AUTHORS.md` — new "Dev info" table (GitHub handle, IDE channel, toolchain versions, link map to all the above).
- README "Docs" section — links the four new docs.

### 🤖 Telegram bot user-guide pointer

- New `docs/telegram-bot.md` — one-page pointer to the external [`telegram-scraper-bot/docs/USER_GUIDE.md`](https://github.com/poli0981/telegram-scraper-bot/blob/main/docs/USER_GUIDE.md), bot source repo, plus a paragraph each on what the bot does and the whitelist lifecycle.
- `CONTRIBUTING.md` — section 3 (`@my_skull_bot`) gets a 3-line callout with the user guide link, bot source URL, and the new in-repo summary doc.
- `web/src/pages/About.tsx` — Maintainer card's privacy note now includes a "Bot user guide & source" sub-card with the same three links.

### 🩺 Health bucket split

- `web/src/pages/Health.tsx` — `gatherIssues()` adds a fifth `IssueGroup`: `OnlineAcUnknown` for games with `type_game === "online"` and `anti_cheat ∈ {"", "-"}`. Previously these games were silently dropped from all categories; now they have a discoverable home.
- Edge-case fix: the existing "Kernel" filter compared `(r.anti_cheat ?? "-") !== "-"`, missing the empty-string case. Both filters now use a normalised `(r.anti_cheat ?? "").trim()`.
- `ShieldQuestion` icon (lucide). EN + VI i18n keys: `health.groupOnlineAcUnknown` + `…Desc`.

### 🎮 Steam Desktop direct link

- New helper `web/src/lib/steam-link.ts` — `steamProtocolUrl(appid)` returns `steam://store/<appid>`, `steamWebUrl(appid)` returns the regular HTTPS store URL.
- `web/src/components/games/GameDetailDrawer.tsx` — single store link replaced by two buttons rendered side-by-side: a primary "Steam Desktop" (`steam://`) and an outline "Web" (`https://`). Tooltip on the desktop button explains the fallback path.
- Works in both web build (browser shows protocol prompt if Steam is installed, silent fail otherwise — Web button is the safety net) and Tauri build (Tauri 2 allows `steam://` navigation by default; no allow-list change needed).
- EN + VI i18n: `detail.openOnSteamDesktop`, `detail.openOnSteamDesktopHint`, `detail.openOnSteamWeb`.

### 🛌 Bi-weekly offline-player leaderboard

- New `scripts/top_offline.py` — clones the `top_online.py` shape but filters `_is_offline(g)` (non-empty `type_game ≠ "online"`). Emits `games/top-offline.md` (top 100 single-player F2P concurrents, 10-column format identical to top-online).
- Calibrated tier thresholds (`_TIERS`) lower than online (offline games rarely break 6-figure concurrents) — `🔥 Mega ≥ 20k`, `⭐ Hot ≥ 5k`, `🟢 Healthy ≥ 1.5k`, `🟡 Stable ≥ 300`, `🟠 Low ≥ 50`, `🔴 Quiet ≥ 10`, `💀 Idle <10`.
- New `bash/offline.sh` matches the shape of `bash/online.sh` (pip install requests → run script → conditional commit).
- New `.github/workflows/top-offline.yml` — cron `0 5 1,15 * *` (1st + 15th of each month at 05:00 UTC) plus `workflow_dispatch`. Shares the unified `data-write` concurrency group.
- Health page (`web/src/pages/Health.tsx`) — new manual trigger button "Top offline" (next to the existing "Top online" trigger).
- **Bug fix during implementation**: `scripts/core/fetcher.py:update_players_only()` had a hardcoded `type_game == "online"` filter that would have made the offline workflow refresh zero rows. Extended with a `type_filter` kwarg (`"online"` default for backward compat, `"offline"`, or `"all"`); `top_offline.py` passes `type_filter="offline"` (excludes both online and empty/unclassified type).

### 🔢 Versioning

| Surface | Old | New |
|---|---|---|
| Repo public-facing | 3.1.0 | **3.2.0** |
| `web/package.json` | 1.1.0 | **1.2.0** |
| `web/src-tauri/Cargo.toml` | 1.1.0 | **1.2.0** |
| `web/src-tauri/tauri.conf.json` | 1.1.0 | **1.2.0** |
| Git tag (signed) | `v3.1.0` | `v3.2.0` |
| Desktop tag (signed) | `desktop-v1.1.0` | `desktop-v1.2.0` |

---

## [v3.1.0] – 2026-05-09 (The "Less CI Noise, Lighter Images, Dead-Game Detection" Edition)

Four PRs landed in this release plus a refresh of the docs and the contributor surface around the new Telegram bot. Web app + desktop app bumped from `1.0.0` → `1.1.0`. Repo public-facing version `3.0.1` → `3.1.0`. Tag `v3.1.0` is GPG-signed; companion desktop tag is `desktop-v1.1.0`.

### 🛠️ CI hygiene — notify wrappers (#60)

- The 3 notify wrappers (`notify-ci-failure`, `notify-deploy`, `notify-release-pipeline`) used to trigger on `workflow_run: workflows: ["*"]` and were filtered out by their reusable callee's `if:` — 95–100 % of runs showed as "skipped". Replaced the catch-all with explicit lists of source workflow `name:` strings per wrapper, plus job-level `if:` to short-circuit non-matching conclusions. Drops skip rate to <10 %.
- Trade-off documented in each file: renaming a source workflow's `name:` field silently breaks notifications; comment warns about the coupling.

### 🖼️ Image optimisation — capsule swap + WebP via wsrv.nl (#61)

- `scripts/generate_tables.py:68` — markdown thumbnails now use `capsule_184x69.jpg` instead of `header.jpg` (~80 % bandwidth reduction at the same 120 px render width).
- Web app `GamesTable` + `CommandPalette` — capsule swap with explicit `width`/`height` to eliminate CLS, plus `onError` fallback to `header.jpg` for the ~5 % of games without a capsule variant.
- `GameDetailDrawer` — `<picture>` element with WebP source via `images.weserv.nl` proxy + JPEG fallback. Lazy-loaded, explicit dimensions.
- `vite.config.ts` — new `CacheFirst` runtime cache for `images.weserv.nl` (`statuses: [200]` only — opaque 0-status would cache proxy errors).
- New helper `web/src/lib/image.ts` — `headerToCapsule()` + `webpProxyUrl()`.

### 💀 Dead-game detection — `mark-dead-games.yml` (#62)

- New cron `Mon + Thu 04:30 UTC` flags **online games released >1 year ago** whose `current_players == 0` for **≥14 days** (configurable via `DEAD_GAME_DAYS` env or `--days` CLI). On trigger: `is_dead = true` + `"💀 Dead game"` appended to `notes` (idempotent).
- **State model**: ISO timestamp `zero_player_since` (robust against schedule drift), not a streak counter.
- **Mark mechanism**: additive `is_dead: bool` + note. `status` stays `"active"` so the existing enum / Top Online filter / chart groupings don't break. Web app gains a "Hide dead" filter toggle and a 💀 emoji prefix on dead rows.
- **Dry-run available**: `python scripts/mark_dead_games.py --dry-run --days 0` for auditing without writes.
- New helper `append_note_idempotent()` in `scripts/core/data_store.py`. Retrofitted onto `check_dead_links.py` to fix duplicate `"💀 Delisted"` accumulation on reruns.
- Schema migration via `_SKELETON_TEMPLATE` only (no one-shot script). Both the Python pipeline and the React app inherit defaults via existing `migrate_record()` / `migrateRecord()` loops.

### 🔄 Concurrency unification

All data-mutating workflows now share `concurrency: { group: data-write, cancel-in-progress: false }`:

- `update-json`, `update-daily`, `top-online`, `update-reviews`
- `check-dead-links`, `purge-unhealthy`, `mark-dead-games` (new)
- `ingest-new`, `ingest-from-issue`, `bot-ingest`, `refetch-all`

Prevents races on `git push` to `data/` shards. Bot-ingest moved from its own `bot-ingest` group to the unified group.

### 📝 Docs + contributor surface (this PR)

- **`AUTHORS.md`** at repo root — handle map for the maintainer, AI-assistant disclosure, MIT licensing reminder.
- **`username.txt`** extended with `telegram bot`, `telegram user`, and `email` lines (canonical machine-readable handle map mirrored by `AUTHORS.md`).
- **`assets/qr/`** — QR-code PNGs for `@my_skull_bot` and `@SkullMute0011` (mirrored to `web/public/qr/` so the SPA can serve them). Generated via `python -m qrcode`.
- **`web/src/pages/About.tsx`** — Maintainer card now lists Telegram bot + Telegram DM (with QR thumbnails inline) + Email. New "Telegram QR codes" card with full-size scannable codes. Privacy note about Telegram `user_id` handling.
- **`CONTRIBUTING.md`** rewrite — adds the `@my_skull_bot` flow as a first-class contribution path (find `user_id` → DM maintainer privately → whitelist → run when bot's online → follow prompts). Loud privacy warning at the top.
- **`docs/PRIVACY_POLICY.md`** — new "Telegram bot" section covering the `user_id` data flow, where it's stored, retention/removal, and the maintainer's commitment.
- **`docs/ToS.md`** — new section 5.1 "Sharing personal information when contributing" with non-negotiable rules about private vs public channels.
- **`docs/Contact.md`** — Telegram bot + DM entries added at the top.
- **README** badges and feature list refreshed (version bumped, dead-game workflow listed, About-page QR card mentioned).

### 🔢 Versioning

| Surface | Old | New |
|---|---|---|
| Repo public-facing | 3.0.1 | **3.1.0** |
| `web/package.json` | 1.0.0 | **1.1.0** |
| `web/src-tauri/Cargo.toml` | 1.0.0 | **1.1.0** |
| `web/src-tauri/tauri.conf.json` | 1.0.0 | **1.1.0** |
| Git tag (signed) | `v3.0.1` | `v3.1.0` |
| Desktop tag (signed) | `desktop-v1.0.0` | `desktop-v1.1.0` |

---

## [v3.0.1] – 2026-05-07 (The "Desktop Actually Ships This Time" Edition)

Same-day post-v3.0.0 maintenance covering Phase 9 (auto-update foundations + CVE bumps + Device Flow scaffold), Phase 10 (Tauri build break + i18n full coverage + deps audit), and Phase 10.1 (minisign keypair rotation). The desktop release pipeline is now end-to-end green — `desktop-v1.0.0` finally produces signed `.msi` / `.exe` / `.dmg` / `.AppImage` / `.deb` / `.rpm` artefacts with a valid `latest.json` for auto-update.

### 🖥️ Phase 9 — auto-update foundations (#56)

- `tauri-plugin-updater` wired into `web/src-tauri/`. Endpoint pinned to the Releases page so installed clients fetch `latest.json` on launch.
- Updater pubkey embedded in `tauri.conf.json` (gated behind a no-op for mobile builds via `#[cfg(not(any(target_os="android", target_os="ios")))]`).
- GitHub Device Flow scaffold added to Settings: signed-in users no longer have to paste a long-lived PAT — they kick off `https://github.com/login/device`, type the user_code, and the app polls until token issuance. Falls back to PAT for the offline path.
- Dependency CVE bumps (vite 5 → 7, vite-plugin-pwa 0.20 → 1.x). Path-traversal fix in source-map handling. No source changes required for the bumps.
- More i18n: a chunk of edit-drawer / activity / dashboard chrome got proper translation keys.

### 🛠️ Phase 10 — Tauri build break + full i18n + deps audit (#57)

- **Tauri lib-name regression fixed.** Phase 9's auto-updater work introduced a `f2p_tracker_lib::run()` call in `main.rs` without declaring `[lib]` in `Cargo.toml`. Cargo's implicit lib name is `f2p_tracker` (hyphens → underscores from the package name) so the call failed to resolve and `cargo build` blew up. Added the explicit Tauri-2-template-style block:
  ```toml
  [lib]
  name = "f2p_tracker_lib"
  crate-type = ["staticlib", "cdylib", "rlib"]
  ```
  The triple crate-type keeps the door open for future `tauri ios init` / `tauri android init` work that `lib.rs`'s `#[cfg_attr(mobile, tauri::mobile_entry_point)]` already implies.
- **i18n now reaches every chrome surface** (~150 new keys across new namespaces `charts`, `activity`, `add`, `system`, `cmdk`, `about`, `bulk`, `detail`, `diff`, `dialogs`, `health`). All 9 chart pages, Activity, Add, Health, Top Online, About headings, drawers (Edit / BulkEdit / Diff / GameDetail), `PwaIndicator`, `QueryState`, `GpgQuickUnlock`, `Topbar` tooltips/aria-labels, `Settings` rate-limit panel, `BulkActionBar` confirm dialog, `GamesTable` tooltips, and `CommandPalette` resolve through `useTranslation`. Long-form About prose stays English per the `settings.languageHint` policy. Enum values (anti-cheat / genre / type_game / safe) stay dataset-stable.
- **Third-party deps audit.** Walked `web/package.json` against `About → Stack & third-party` and `docs/ACKNOWLEDGEMENTs.md`. Added missing entries: `react-router-dom`, the i18next stack (`i18next` + `react-i18next` + `i18next-browser-languagedetector`), Tauri 2 + plugins (shell / updater / process), `echarts-for-react`, the styling utilities (`class-variance-authority` / `clsx` / `tailwind-merge` / `tailwindcss-animate`), and PostCSS + autoprefixer. Vite version corrected 5 → 7 (was already bumped by Phase 9; About just hadn't caught up).
- `ACKNOWLEDGEMENTs.md` restructured into grouped sections (runtime/build, styling, UI primitives, routing & i18n, data & state, charts, crypto & PWA, desktop) with deep links + SPDX licences.
- `web/src-tauri/Cargo.lock` now committed for reproducible desktop builds.

### 🔑 Phase 10.1 — minisign keypair rotation (#58)

- `desktop-v1.0.0` was failing at the final sign-updater-bundle step:
  ```
  failed to decode secret key: incorrect updater private key password:
                                Missing comment in secret key
  ```
  minisign formats the error so the inner "Missing comment" is the symptom of a wrong password — when the password is wrong, decryption returns garbage and the expected `untrusted comment: minisign encrypted secret key` header bytes don't appear. The original keypair's password was lost, so the GH secret could no longer decrypt the key.
- Re-keyed via `npx tauri signer generate --ci -p ""` with no password. Stored at `~/.tauri/f2p-tracker{,.pub}` on the maintainer's box; `web/src-tauri/.gitignore` extended (`*.key`, `f2p-tracker{,.pub}`) as a guardrail in case keys ever land in `src-tauri/` during dev.
- New pubkey baked into `tauri.conf.json` `plugins.updater.pubkey`. GH secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` rotated via `gh secret set` (password = empty string).
- **Trade-off**: any user already on a build signed with the old key would have their auto-update break. Nobody hit that path because Phase 9 / Phase 10 release runs both failed before publishing artefacts. Phase 10.1's rebuild is the first actually-shipped `desktop-v1.0.0`.

### 🏷️ Tag handling

- `desktop-v1.0.0` was force-pushed twice in this cycle as the workflow input commit advanced (Phase 9 → Phase 10 → Phase 10.1). The triggering tag is GPG-signed each time. Once the auto-update story is real users-on-it, future fixes should bump `desktop-v1.0.x` instead of force-pushing.

### 📝 Docs (this release)

- `CHANGELOG.md` — this entry.
- `web/src-tauri/Cargo.toml` + `tauri.conf.json` + `.gitignore` — Phase 10 / 10.1 changes documented in their own commit messages and PR bodies (#57, #58).

---

## [v3.0.0] – 2026-05-07 (The "It Has a Website Now" Edition)

The repo is no longer just a list. It is a **list + a React/Vite web app + a Tauri desktop app**, all reading the same Python-pipeline-maintained data.

### 🌐 Web app — `web/` + GitHub Pages

Built across phases 1 → 7. Live at <https://poli0981.github.io/free-steam-games-list/>.

- **Phase 1** — read-only browse: virtualised 1.2k-row TanStack table, faceted filters, Fuse.js fuzzy search, 4 ECharts MVP charts (KPI, top-online, genre treemap, platform donut), GitHub Pages deploy via `actions/deploy-pages`.
- **Phase 2** — PAT-based GitHub auth, single-record edit drawer for the 8 manual fields, diff viewer, single + bulk Steam-link queue into `scripts/temp_info.jsonl`, conflict-retry, sonner toasts.
- **Phase 3** — client-side OpenPGP signing via Git Data API: switched all writes from Contents API to `commitFile(getHead → createBlob → createTree → buildCommitContent → openpgp.sign → createCommit → updateRef)`. Settings panel with passphrase unlock + lock indicator. Earlier claim that PATs auto-sign was wrong — Contents API commits land Unverified.
- **Phase 4** — fixed GPG salt-notation incompatibility (`config.nonDeterministicSignaturesViaNotation: false`) so OpenPGP.js v6 signatures parse on GitHub. Bulk edit + bulk delete in one signed multi-shard commit. 8 remaining charts (tags wordcloud, AC stacked, languages heatmap, release-year histogram, catalog-growth cumulative line, reviews histogram, online player tiers pie, DRM/DLC bars). Health page with workflow_dispatch buttons. ⌘K command palette (cmdk).
- **Phase 4.1** — GPG signature payload fix: dropped trailing `\n` after the commit message so our signed bytes match `verification.payload` byte-for-byte. Verified via `gh api .../commits/{sha}.commit.verification.reason → valid`.
- **Phase 5** — PWA (installable, offline shell + last-known data via Workbox), GPG identity override (multi-UID picker), GPG idle auto-lock 5/15/30/60 min, Activity feed page (`/activity`) with Verified-status badges + Me/Bots/All filters.
- **Phase 6** — curated enums (`ANTI_CHEAT_ENUM`, `GENRE_ENUM`) + dropdowns, JSON-editor toggle in the edit drawer (full-record replace), manual-field overrides on Add (single + bulk JSON mode propagates `genre/type_game/anti_cheat/notes/safe` straight into `temp_info.jsonl`), GamesTable pagination 50/100/200/500/all + hidden scrollbar + per-row validation badge, per-game permalinks `/games/:appid` with friendly 404 drawer, verify-after-commit polling (toast updates with `verification.reason` once GitHub confirms), CSV/JSON export of the filtered subset, About page (repo + dev info from `username.txt` + 3rd-party stack + issue templates), topbar GPG quick-unlock popover, owner-gate (`useIsOwner` + `OWNER_LOGIN`) hides edit/add/delete UI from non-owners.
- **Phase 6.1** — Edit Always Failing fix: Contents API caps `content` at 1 MB; `data/data_001.jsonl` is 1.49 MB so the read came back empty and every edit threw "Record not found". New `getRepoFileText()` helper falls back to the `/git/blobs/{sha}` endpoint for oversize files.
- **Phase 6.2** — stale-after-edit fix: bumped `data/index.json.last_updated` in every shard-modifying commit AND switched the SW cache to `NetworkFirst` (raw.github CDN is Fastly-cached for 5 min). Plus optimistic-update helpers (`optimisticEdit/Replace/BulkEdit/BulkDelete`) write straight to TanStack + IndexedDB so the editor sees their own change instantly without waiting for the CDN.
- **Phase 7** — date-column sort fix (`parseReleaseDate`), hamburger mobile nav (Sheet drawer, auto-close on route change), About expansion (Heads-up caveats + AI disclosure + legal links + per-third-party SPDX licence badges), legal docs rewritten (DISCLAIMER + EULA + ToS + PRIVACY) with the four caveats from `notes.txt` (genre best-effort, English-only, test-data leakage, unsigned-commit dev artefacts), refreshed `bug_report.yml`, workflow Node 20 → 24 + actions versions bumped.

### 🌍 i18n — vi / en (Phase 8, this release)

- `react-i18next` + `i18next-browser-languagedetector`. Resource files `src/i18n/locales/{en,vi}.json`.
- Auto-detect from `navigator.language` on first load; persistent override via Settings → Language.
- Sidebar nav, Topbar, Settings, Dashboard, Top Online, common buttons, common toast strings translated. Long-form legal copy stays English by design (legal review hard to mirror exactly across two languages).

### 🖥️ Desktop app — Tauri 2 (Phase 8, this release)

- `web/src-tauri/` Rust scaffold targeting Tauri 2. Single `main` window, fixed 1400 × 900, no resize, no maximise, dark theme, centred at startup.
- `tauri-plugin-shell` for opening external links to Steam / GitHub from the embedded UI.
- New `release-desktop.yml` workflow: matrix `ubuntu-latest` / `windows-latest` / `macos-latest`, Apple Silicon + Intel universal binaries, `tauri-apps/tauri-action`. Triggered by `desktop-v*` tags or manual workflow run. Each run creates a draft GitHub Release with `.msi` / `.dmg` / `.AppImage` / `.deb` assets.
- `npm run tauri:dev` and `npm run tauri:build` from `web/` for local builds.

### 📦 Versioning

- Repo version badge **2.1.0 → 3.0.0**.
- `web/package.json` **0.1.0 → 1.0.0** (web app considered first-stable).
- `web/src-tauri/Cargo.toml` and `tauri.conf.json` ship at `1.0.0`.

### 📝 Docs (this release)

- `README.md` — rewrite: web app + desktop sections, updated Quick Links table, new architecture diagram, refreshed contribute paths, refreshed docs index.
- `CHANGELOG.md` — this entry consolidating phases 1 → 8.
- `docs/ACKNOWLEDGEMENTs.md` — refreshed with phase-by-phase AI assistance breakdown (Grok v1; Claude for v2 + the entire web/desktop layer + this changelog).
- `web/README.md` — phase 8 status appended.

### 🛠️ Pipelines unchanged

- All 9 v2.x Python pipeline workflows (update-json, generate-tables, top-online, update-reviews, dead-link-check, purge-unhealthy, ingest-new, ingest-from-issue, refetch-all) keep their schedules and behaviour. Two new workflows added: `deploy-pages.yml` (Phase 1) and `release-desktop.yml` (Phase 8).

---

## [v2.1.0] - 2026-03-28 (The "Extension-Ready + Performance" Edition)

### 💥 Breaking Changes

- `desc` field **removed** from schema. Use `description` only. Migration script handles upgrade automatically.
- `free_type` field removed (unreliable from API, extension handles classification client-side).
- `jsonlines` pip dependency dropped – all I/O now uses stdlib `json` (faster, zero deps).
- `fetcher.py` function renamed: `_process_batch()` → `process_batch()` (public API).

### 🏗️ Schema v2.1 (Extension-Compatible)

- **7 new fields** added to every game record, matching Chrome extension output:
    - `publisher` (list) – e.g. `["Square Enix", "Feral Interactive (Mac)"]`
    - `platforms` (list) – e.g. `["Windows", "macOS", "Linux"]`
    - `languages` (list) – e.g. `["English", "French", "Japanese"]`
    - `language_details` (list[dict]) – per-language `{name, interface, audio, subtitles}` booleans
    - `tags` (list) – all user-defined Steam tags including hidden overflow
    - `anti_cheat_note` (str) – raw anti-cheat name from store page
    - `is_kernel_ac` (bool|null) – `true` = kernel-level, `false` = non-kernel, `null` = unknown
- `developer` normalized: string → list everywhere (API, extension, migration).
- `desc` merged into `description`, then dropped. One field, no duplication.

### 🔌 Extension Data Integration

- New `merge_extension_data()` in `data_store.py` – smart merge with 3-tier priority:
    - **MANUAL_FIELDS** (notes, safe, type_game, genre, anti_cheat): only fill if empty (preserves user edits).
    - **ARRAY_FIELDS** (developer, publisher, platforms, languages, tags): replace wholesale (extension data is richer).
    - **Other fields**: overwrite if extension provides non-empty value.
- `ingest_new.py` now accepts full extension output (20+ fields per entry) – merges before fetch, re-applies manual
  overrides after fetch.
- Ingest summary shows field counts: `dev=DONTNOD plat=[Windows, macOS, Linux] langs=6 tags=20`.

### 🔍 HTML Scraper (New Module)

- New `scraper.py` – extracts data unavailable from Steam API:
    - **Language table**: parses `<table class="game_language_options">` → accurate Interface/Audio/Subtitles per
      language (API only gives a broken HTML string with no subtitle info).
    - **DLC pricing**: parses `#gameAreaDLCSection` → checks `data-price-final` per DLC row. Only marks
      `has_paid_dlc=true` if at least one DLC has actual non-zero price (API just lists DLC IDs with no prices).
    - **Tags**: parses `.app_tag` elements including `display:none` overflow tags (API `appdetails` doesn't return user
      tags at all).
- All 3 extracted from **single GET request** to store page – one HTML fetch per game, not three.
- 8 regex patterns pre-compiled at module level.

### ⚡ Performance Optimizations

- **Eliminated double-fetch in ingest**: `health_checker` now caches API response in `HealthResult.data`.
  `ingest_new.py` passes `prefetched_details=health.data` to `fetch_full()` → skips redundant `fetch_app_details()`
  call. Saves 1 API request per game (300 games = ~450s saved).
- **Dropped jsonlines dependency**: `load_jsonl()` uses `json.loads()` line-by-line, `save_jsonl()` uses
  `json.dumps()` + `f.write()` directly. ~20-30% faster I/O for large files, zero pip deps for core.
- **Pre-compiled regex**: `scraper.py` compiles all 8 patterns at import time, not per-call. 300 games = 8 compiles
  instead of 2400.
- **Faster `is_empty()`**: uses `frozenset` lookup for empty string variants, early returns for `None`/`list`.
- **`SteamClient.__slots__`**: reduced memory per instance, faster attribute access.
- **`extract_appid()` regex simplified**: `/app/(\d+)` instead of full domain match – shorter, same correctness.
- **`make_skeleton()` template**: shallow-copies from frozen template dict instead of building from scratch.
- **`generate_tables.py`**: `lines.extend(generator)` instead of `append()` loop.

### 🔄 New Scripts & Workflows

- `refetch_all.py` + `refetch-all.yml` – **manual-only** force re-fetch of ALL games into v2.1 schema. Creates backup →
  migrates → clears fetchable fields → re-fetches from Steam API + HTML scrape. Preserves manual fields (notes, safe,
  type_game). Requires typing `"yes"` to confirm. Timeout: 120 minutes.
- `migrate_schema.py` + `migrate-schema.yml` – upgrades existing `data.jsonl` records: adds missing fields, normalizes
  types, drops deprecated fields. Idempotent.

### 🐛 Bug Fixes

- **`languages` corrupted**: API HTML string `"Brazil<br>languages with full audio"` was parsed as
  `"Brazillanguages..."`. Fixed by switching to HTML table scraping.
- **`subtitles` always `false`**: API has no subtitle breakdown. Fixed by parsing store page language table (
  Interface/Audio/Subtitles columns).
- **`has_paid_dlc` false positives**: Games with free-only DLC were marked `true`. Fixed by scraping actual
  `data-price-final` attributes.
- **`description` duplicated**: Both `desc` and `description` stored same text. Unified to `description` only.

### 🧹 Improved

- Tables: Publisher column, Platforms column, Language count, kernel anti-cheat badge (🔴/🟢).
- `health_checker.py`: `@dataclass(slots=True)` for leaner objects.
- `top_online.py`: tier thresholds as tuple list (cleaner).
- All scripts: consistent `sys.path.insert(0, ...)` for imports.

---

## [v2.0.0] - 2026-03-26 (The "Finally Got Serious" Edition)

### 💥 Breaking Changes

- Data format migrated from `data.json` to `data.jsonl` (JSON Lines).
- All Python scripts rewritten from scratch under `scripts/core/` modular architecture.
- Bash scripts rewritten with `set -euo pipefail`.

### 🏗️ Architecture (Complete Rewrite)

- Modular core: `constants.py`, `steam_client.py`, `data_store.py`, `fetcher.py`, `health_checker.py`.
- Rate-limited HTTP client with backoff, retry, 429 handling, session pooling.
- Health detection (5 statuses), purge, dead link check, pre-flight ingest validation.
- New ingest flow: `temp_info.jsonl` → validate → dedup → health check → fetch → `data.jsonl`.
- 9 CI/CD workflows. Metacritic, DRM, Peak Today, Status columns. Top Online leaderboard with trends.

---

## [v1.1.2] - 2026-01-11

- 40+ games added.

## [v1.1.1] - 2026-01-07

- 50+ games, delete/dedup scripts, CSV export, auto CSV Actions. (by [@poli0981](https://github.com/poli0981))

## [v1.1.0] - 2025-12-30 (Scale Noob Edition)

- Split all-games.md into parts. Smart fetch skip. Wiki. Issue templates.
- Batch + delay optimize for 500+ games. Various Action fixes.

Previous: [v1.0.0] – Initial stable.

Made with boredom, instant noodles, sale addiction, and AI power ✨