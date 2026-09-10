## GAP REVIEW — seven designs vs. the 15 stated asks

Verified against `E:\2` at `dd6532ea` (read-only). Where I checked a design's claim myself I say so.

---

## Per-ask verdicts

### 1. Remember the project's important points — **PARTIALLY COVERED**
Only `docs-legal` §7.4 addresses this, and only as an **outline of headings** for a new `ARCHITECTURE.md`. Missing concretely:
- **No canonical fact sheet is actually written.** No `CLAUDE.md` exists at the repo root (verified) and none is proposed. A future session has nothing to load.
- **The seven designs contradict each other on "verified" facts** (see Conflicts below), so there is no single trustworthy record. Nobody is designated to reconcile them.
- Load-bearing invariants that appear in *some* designs but are never collected in one place: `appid` is not a stored field (parsed from `link`); numeric fields are formatted strings; `MANUAL_FIELDS` are never overwritten; `save_main()` re-shards on every run so shard mapping is unstable; `index.json.last_updated` is the sole cache-invalidation signal; the `schema.ts` ↔ `constants.py` mirror contract.
- No decision on where this lives or who updates it when the pipeline changes.

### 2. Comprehensive web plan for free-steam-games.win — **PARTIALLY COVERED**
`cloudflare-platform` is strong on DNS/SSL/routing. Missing entirely across all seven:
- **No MX / null-MX / SPF / DMARC / DKIM / CAA records.** The project publishes `lopop05905@proton.me` in four files and `docs-legal` makes a *legal takedown commitment* to that address; the new domain is spoofable and none of the takedown mail will be authenticated. `deps-security` mentions SPF/DMARC only to declare it out of scope for bug reports — that is a dismissal, not a design.
- **No WAF / Rate Limiting Rules / Bot Fight Mode / Turnstile.** The only abuse control designed anywhere is the appid allowlist on `/img/*`. `/api/*` has app-level batch caps (`admin-d1`) but no edge rate limit — which is the primary cost and DoS control on a Worker, and the direct mitigation for `admin-d1`'s own S7 (D1 quota DoS).
- **No cost model with numbers.** `docs-legal` lists "Cost model" as a heading; `images-caching` prices transformations only. Nothing prices Workers requests, D1 on Workers Paid, or the total monthly bill — despite the whole platform being a paid plan the owner funds personally.
- **No budget alerting** beyond one line in `images-caching` (a notification at 4,000 transformations). Nothing for Worker invocations, D1 rows, or Images spend.
- **No analytics decision.** `docs-legal` *asserts* in the new Privacy Policy that no Cloudflare analytics/Logpush is enabled. That is a claim about a setting nobody has decided or checked.
- **Sitemap/SEO is unresolved.** With BrowserRouter every `/games/:appid` becomes indexable. Nobody decides whether the sitemap carries 3,424 game URLs, or how it's generated (static file vs. pipeline output). `cloudflare-platform` says "the actual route list" — ~20 URLs — which forfeits the migration's largest SEO opportunity without saying so.
- **No Google Search Console / change-of-address step.** The old-host handoff is a JS `location.replace` + canonical only; GitHub Pages cannot 301 and nobody proposes the one remaining consolidation lever.
- **No preview-environment policy.** `cloudflare-platform` presents Workers Builds preview URLs as a free benefit; `admin-d1` says "audit those" with no mechanism. Preview URLs are outside the zone, therefore outside Cloudflare Access.

### 3. Completely refresh the interface — **PARTIALLY COVERED**
`ui-welcome` designs the *system* (tokens, motion, IA, primitives, a11y) thoroughly. It does not design the *product*. Missing:
- **No page-level designs.** Verified routes: Dashboard, Games (+detail drawer), 10 chart pages, `/charts/anti-cheat/list`, Health, Activity, Add, About, Donate, Settings, `/error/:code`, 404. The only new page specified is `/charts` ("a grid of 11 cards"). Nothing says what any existing page looks like after the refresh.
- **The GameDetailDrawer** — the app's most-used surface — gets image and CLS notes only, no redesign.
- **No empty / loading / error / offline state design** beyond "add a skeleton primitive".
- **No admin UI visual design.** `admin-d1` specifies admin screens and behaviour; `ui-welcome` explicitly scopes admin out. A separate Vite entry means a second app shell with no tokens, no nav, no a11y, no i18n owner.
- **No visual QA plan.** No screenshots, no before/after, no visual-regression tooling, no browser/device matrix (only the Tailwind-4 WebView ≥111 floor is stated).
- **i18n debt is identified, not scheduled.** `ui-welcome` flags `About.tsx` (~9 blocks), `KpiCards.tsx` (7), `CommandPalette.tsx` (17) as untranslated but assigns none of it to a stage; `vi.json` parity has no gate.
- **No decision on the `lang="vi"` default.** `ui-welcome` says set `en`, `docs-legal` argues Vietnamese is the likely-largest audience and adds a Vietnamese legal summary. Nobody resolves which is the primary locale.

### 4. Welcome page after the legal gate — **COVERED**, three small gaps
- **The two designs contradict on persistence.** `ui-welcome` §1.3 specifies `f2p:welcome_seen` **with** a `WELCOME_VERSION`; `docs-legal` §8.5 specifies it **explicitly without** a version. Trivial, but shipped as-is they differ.
- **The origin change wipes localStorage**, so *every existing user* gets the welcome page on first visit to the new domain. Nobody states this as intended.
- **No Tauri consideration:** `tauri.conf.json` pins a non-resizable 1400×900 window; the welcome page is designed responsive and is the desktop first-run screen.

### 5. Move image loading onto Cloudflare — **COVERED BUT UNRECONCILED**
Two complete, mutually incompatible designs (different URL grammar, different variant sets, different Tauri behaviour, different `wrangler.jsonc`). Beyond the conflict, both are missing:
- **No `og.png`.** `cloudflare-platform` correctly finds that `og:image` is an SVG that every social scraper refuses, and says "generate a 1200×630 PNG" — verified `web/public/` contains only `favicon.svg`, `icon-192.svg`, `icon-512.svg`. Nobody designs how that PNG (or the 512 PNG icon `images-caching` asks for) gets produced or kept in sync.
- **`assets/qr/*.png`** (verified tracked) and the About page's images are never routed.
- **`avatars.githubusercontent.com`** stays third-party in both designs, contradicting the Privacy Policy rewrite's "every load-critical resource is same-origin" framing.
- **Android/desktop image path is contradictory:** `images-caching` deletes the `isTauri()` bypass (verified at `image.ts:37`) and routes native traffic through the Worker; `cloudflare-platform` and `docs-legal` both keep/describe the bypass — and `docs-legal`'s Privacy Policy text *documents the bypass as a deliberate trade*. One of those docs will be false on day one.
- **"No purge is ever needed"** (`images-caching`) is asserted from `?t=` being an mtime, not verified against a case where Steam replaces art without changing the token.

### 6. Caching / loading / security guidance — **PARTIALLY COVERED**
- **Caching: the foundational decision is unresolved.** `images-caching` ships `data/` inside `dist/` as content-addressed static assets (requires a `data_store.py` change to emit `sha8` filenames + a CORE/DETAIL split); `cloudflare-platform` proxies `raw.githubusercontent.com` through `/api/data/*` with a 60s/300s edge TTL and no pipeline change. They imply different `_headers`, different Workbox rules, different `fetcher.ts`, and different admin cache-purge requirements. Nobody picks.
- **Loading: no measurement plan.** No Lighthouse/CrUX baseline, no performance budget, no CI perf gate. Every performance claim ends in "profile it before and after" with no owner and no tool.
- **Security gaps:** no threat model (only a heading in `ARCHITECTURE.md`); no secrets inventory/rotation schedule as an artifact (only a heading in `ADMIN.md`); no `Permissions-Policy` in the Tauri CSP; no COEP/CORP decision for the web (only COOP); **no Dependabot/audit coverage for the Worker's own dependency tree** — `deps-security`'s `dependabot.yml` covers `/web`, `/web/src-tauri`, `/`, and actions, but not `worker/` or `/workers/api`, which will carry `jose`/`wrangler` and is the one component holding a repo-write credential.
- **The stranded-credential risk has no owner.** `admin-d1` proposes a boot-time purge of `f2p:gh_token`/`f2p:gpg_armored` — but on the new origin those keys never existed, so the purge is a no-op, and `cloudflare-platform` correctly forbids `localStorage.clear()` in the Pages tombstone. Net result: the live PAT and armored private key stay in the old origin's storage indefinitely, and no design closes that.

### 7. Hidden/gated admin + Cloudflare DB — **COVERED**, ops gaps
`admin-d1` is the deepest document here. Missing:
- **No D1 backup / export / restore design** (a heading in `docs-legal`'s `DEPLOYMENT.md`; absent from `admin-d1`).
- **No local development story.** You cannot mint an Access JWT against `wrangler dev`. Nothing says how the admin UI or `/api/admin/*` is developed or tested before production.
- **No migration rollback** beyond "additive only, never rename".
- **Unresolved: do the three legacy ingest paths survive?** `admin-d1` says issue-driven ingest "becomes redundant once the D1 queue exists"; `ci-automation` invests substantial design in repairing `ingest-from-issue.yml` (author gate, `&&`/`||` chain) and `bot-ingest.yml`. Nobody decides keep vs. kill, so both plans get built.
- **The owner loses mobile admin.** `admin-d1` §4.7 compiles admin out of Tauri because the Access cookie doesn't survive the webview. That means approvals are desktop-browser-only. Never stated as a consequence.
- **No D1 pricing** on Workers Paid.

### 8. Inspect and fix CI, including rescheduling — **COVERED**, with real gaps
`ci-automation` is the strongest document in the set (the ~115-minute job durations and the concurrency-eviction blind spot are findings nobody else has). Missing:
- **No Python lint/test gate.** Verified: zero `ruff`/`pytest` references anywhere in `.github/workflows/`, `pyproject.toml`, or `requirements-dev.txt`, despite `pyproject.toml` and a local `.ruff_cache` existing. Nobody adds one.
- **No functional tests, anywhere, for anything.** The combined plan is: five frontend majors + a new Worker + a new database + a new write path into `main`, gated by `tsc -b && vite build`. `deps-security` adds audit gates only.
- **No CI check for the Worker.** No `worker/` typecheck, no `wrangler deploy --dry-run`, no D1 migration validation. `cloudflare-platform` notes `web/tsconfig.json` `include` is `["src","vite.config.ts"]` so `worker/` ships untyped, and proposes a project reference — but no workflow runs it. Nobody separates "no *deploy* workflow" (ask 14) from "no *check* workflow", which is a distinction the user never forbade.
- **`bash/daily.sh` is absent from every design.** Verified it exists (11 scripts, not 10).
- **Nobody says when the four untracked snapshot files get committed** — `scripts/snapshot.py`, `bash/snapshot.sh`, `.github/workflows/snapshot-daily.yml`, `data/snapshots/2026-04-28.jsonl` are still untracked and no PR in any landing order claims them.

### 9. Surface new games within a day into an admin-only area — **PARTIALLY COVERED / CONTRADICTORY**
Two designs answer this with **opposite ends of the funnel**, both claiming `/api/admin/queue*`:
- `admin-d1` §2 builds an actual **discoverer** (`scripts/discover_new.py`: Steam `GetAppList` delta → minus existing → minus suppressed → health-check → POST candidates → queue → owner approves → `scripts/temp_info.jsonl` → existing ingest pipeline). Correctly identifies that no discovery step exists today (verified: `scripts/` has no discovery module; ingestion starts from `temp_info.jsonl`).
- `ci-automation` §8 defines "new games" as **records already committed** with `added_at` within 36h, pushed to D1 after the fact.

If `ci-automation`'s version ships, the ask is **not satisfied** — the games are already public in `data/*.jsonl` before the admin ever sees them. Nobody flags the divergence.

Missing in both: no notification when N candidates are waiting (the project already has a Telegram channel and a Discord webhook — neither is wired to the queue); no design for a queue left unreviewed for weeks beyond a `507 queue_full`; the daily `GetAppList` delta volume is unverified, so the discovery budget is a guess.

### 10. Update docs, split the license — **COVERED (as outlines)**
`docs-legal`'s 67-row contradiction table is the most actionable artifact in the set. Missing:
- **No CHANGELOG entry** for the migration itself (75KB file, latest v3.4.2).
- **No README rewrite.** Only a fix-list. The design notes two duplicate `<summary><b>Architecture</b></summary>` blocks and says "collapse into one" without specifying the result.
- **The `description` truncation to 180 chars is unreconciled with two other designs**: `images-caching` puts `description` (751 KB, 12.5%) in the DETAIL shard and rebuilds Fuse over it; truncation changes both the byte math and search relevance. It is also a 3,424-record rewrite that must hold `concurrency: data-write` — which `snapshot-daily.yml` currently lacks.
- **No PR sequencing.** Which doc edits are blocked on DNS, which on the license split, which can land now.

### 11. Update EULA / Privacy / etc. — **PARTIALLY COVERED**
Outlines plus several strong drop-in paragraphs, but **the replacement documents are not written**. Also missing: no versioning/effective-date mechanism for the docs themselves beyond `TERMS_VERSION`; no plan for the `docs/i18n/vi/` legal summary's maintenance; `web/src/lib/legal.ts` (verified: 7 docs, 5 with `consent: true`) grows to 11 entries with new in-app routes, and the `/legal/*` renderer's markdown sanitization library is unspecified (a new runtime dependency with an XSS surface, on the origin that holds the GitHub token).

### 12. Fix audit, upgrade to latest — **COVERED BUT BLOCKED**
`deps-security` materially corrects the brief (the lockfile already resolves `echarts` 6.1.0; the real blocker is `echarts-wordcloud@2.1.0`'s hard `echarts@^5` peer, which makes `npm install` fail outright today). Missing:
- **The blocking unknown is unowned.** Whether `echarts-wordcloud` still renders under echarts 6 gates `npm install`, therefore every frontend stage in every design. Nobody is assigned to load `/charts/tags` and look.
- **No per-stage rollback** and **no per-stage verification** beyond "verify dev under StrictMode".
- **TypeScript "latest" (7.0.2) is deliberately deferred to 6.0.3** against the user's explicit "latest" instruction. Well reasoned, but it is a deviation from a stated decision and is not surfaced for sign-off.
- `lucide-react` 0.x→1.x similarly deferred and pinned in `ignore` — same issue.

### 13. Outdated workflow/npm versions, Dependabot, scanning alerts — **COVERED, WITH A COLLISION**
- **Two different `.github/dependabot.yml` files** are proposed for the same path (`ci-automation` §3.1 minimal; `deps-security` §8 grouped with `applies-to`). Unresolved.
- Only `deps-security` notes that an in-repo `dependabot.yml` **overrides the repo-settings config entirely** and supersedes open PR #111. `ci-automation` proposes committing one without that caveat.
- `tauri-apps/tauri-action@v0` is correctly identified as unfixable by Dependabot (floating major-zero), but the two designs prescribe different remedies (`ci-automation`: SHA-pin to `action-v1.0.0`; `deps-security`: pin to a concrete release or SHA).
- The legacy duplicate `CodeQL` workflow registration gets "deregister the legacy one" with no procedure.

### 14. Only a wrangler.jsonc is needed, no CI — **PARTIALLY COVERED / BLOCKING CONFLICT**
This is the ask with the least resolution. **Three incompatible `wrangler.jsonc` files at two paths:**

| Design | Path | Builds root dir | `main` | `assets.directory` |
|---|---|---|---|---|
| cloudflare-platform | `web/wrangler.jsonc` | `web` | `./worker/index.ts` | `./dist` |
| admin-d1 | `/wrangler.jsonc` (repo root) | repo root | `workers/api/src/index.ts` | `web/dist` |
| images-caching | (unstated) | — | `worker/index.ts` | `./dist` |

- `cloudflare-platform` argues the repo-root layout **breaks dependency auto-install** (no root `package.json`) and forces a `cd web &&` build command.
- `admin-d1` **requires** the repo-root layout so the Worker can import `web/src/lib/git-data.ts`, `jsonl-shard.ts`, and `schema.ts` — and lists this as open item #6, admitting *both* designs break if the assumption is wrong.
- `workers_dev` is directly opposed: `cloudflare-platform` keeps `workers.dev` enabled as the rollback/preview target; `admin-d1` sets `workers_dev: false` because a zone Access app does not cover it (its own failure mode S2).
- **Build watch paths only make sense under one layout**: `cloudflare-platform` says include `web/*`; `ci-automation` says exclude `data/**`, `games/**`, `data/snapshots/**` — which are outside `web/` and therefore already excluded if root dir is `web`.
- `run_worker_first` differs across all three (`["/api/*","/img/*"]` vs `["/api/*","/admin","/admin/*"]` vs `["/img/*","/api/*"]`), and none is a superset.

Also missing: no single first-deploy checklist ordering D1 creation → migrations → Access apps → `custom_domain` → first push. Pieces exist in three separate documents.

### 15. Step-by-step setup guidance — **LARGELY MISSING**
Five separate orderings exist (`cloudflare-platform` §6.5, `ci-automation` §9, `deps-security` stages 0–8, `ui-welcome` §6.4, `docs-legal` implicit). There is **no cross-workstream sequence**, and the fragments contain at least one genuine circular dependency and several unstated blocks:
- **Circular:** `ui-welcome` step 6 needs the CSP hash for the inline theme/lang bootstrap script → that hash comes from `deps-security` stage 7 → which states the CSP "has to be written against the **final** bundle", i.e. after step 6.
- **Unstated blocks:** `deps-security` stage 0a (`echarts-wordcloud` override) blocks every frontend stage in `ui-welcome`; `ci-automation` stage 5 blocks on DNS; `admin-d1`'s approve→ingest loop blocks on `ci-automation` stage 1.
- **No consolidated "owner-only, by hand" list.** These are scattered across four documents and never collected: rotate or delete `GH_TOKEN`; delete `BOT_TOKEN`; export the GPG key + PAT **before** the origin change; create the Cloudflare API token; `wrangler d1 create` + apply migrations **before** the dependent deploy; create the Access apps and the ingest service token; create the GitHub App and install it; set Workers Builds root directory; set repo Pages source to None; delete the `github-pages` environment; update the GitHub OAuth App homepage URL; verify Images Transformations is enabled on the zone; confirm the Worker is on the paid plan.
- **No per-step acceptance check** (`cloudflare-platform` §6.5 is the closest; `docs-legal` lists "Verification checklist — 12 things" as a heading only).
- **No rollback per step** beyond re-enabling `deploy-pages.yml`.

---

## Cross-design conflicts nobody owns (these are gaps by another name)

1. **wrangler.jsonc layout** — three versions, two paths, opposed `workers_dev`. Blocks ask 14.
2. **Where `data/` is served from** — static assets vs. Worker proxy. Blocks asks 5, 6, and the pipeline change in `data_store.py`.
3. **Image URL grammar** — `/img/{width}/{hostToken}/{path}` vs `/img/{variant}/{appid}[/hash]/{asset}`. Both rewrite `lib/image.ts` and both edit the same four consumers (verified: `columns.tsx:35`, `MobileGameCards.tsx:94`, `GameDetailDrawer.tsx:109`, `CommandPalette.tsx:211`).
4. **"New games" definition** — pre-ingest discovery vs. post-commit `added_at` window. Blocks ask 9.
5. **`/add` and the owner UI** — `admin-d1` deletes `stores/auth.ts`, `useCommitContext`, the whole GPG stack, and moves `/add` behind Access; `ui-welcome` keeps `/add` owner-gated in the sidebar via `useIsOwner()` and keeps a "Lock GPG key" command-palette action. Mutually exclusive.
6. **`echarts-for-react`** — `ui-welcome` says drop it (peer excludes React 19); `deps-security` says the registry peer is `>=16.0.0`, permissive, keep it. One of these is factually wrong.
7. **`sonner`** — `ui-welcome` says 1.5→2.x is required for React 19; `deps-security` verified 1.7.4 already declares `^18||^19`.
8. **`zustand`** — `ui-welcome` says v4's shim conflicts under 19 (must bump); `deps-security` says the peer range is satisfied and v5 is a free bonus.
9. **`dependabot.yml`** — two files, same path.
10. **`description` truncation** vs. the CORE/DETAIL split and Fuse search.
11. **Tauri image path** — `isTauri()` bypass removed vs. retained, with the Privacy Policy text documenting the retained behaviour.

---

## Assumed but never verified

**Flagged by at least one design (still open):** Workers Builds root-directory / assets-directory / auto-install behaviour (`admin-d1` open item #6 — *both* it and `cloudflare-platform` break if wrong); `_headers` support on Workers Static Assets (`cloudflare-platform` asserts it works with one sub-caveat, `images-caching` flags the whole mechanism as unverified — contradictory confidence on the same unknown); Cloudflare Images pricing shape and per-zone enablement (the entire §3 cost decision rests on it); D1 `STRICT` tables, partial unique indexes, and max row size; Access service-token JWT claim shape (`common_name` vs `sub`); GitHub `createCommitOnBranch` auto-signing **with an App installation token** (gates whether the GPG stack can be deleted); `openpgp` v6 in the Workers runtime; `echarts-wordcloud` on echarts 6 (blocks `npm install`); BrowserRouter in the Tauri webview on macOS/Android; Steam `GetAppList` daily delta volume and rate limits.

**Not flagged by anyone:**
- **The DNS open-items lists are stale.** `cloudflare-platform` verified the zone is already active on Cloudflare (NS `charles`/`desi.ns.cloudflare.com`, apex NOERROR/NODATA, `www` NXDOMAIN). `admin-d1` (#7) and `images-caching` still carry "the domain does not resolve" as an unresolved blocker — they never re-checked.
- **Nobody verified the Cloudflare account state**: that Workers Paid applies to the account hosting this Worker, that Images Transformations is enabled on this zone, or that Access/Zero Trust is provisioned.
- **Nobody read `poli0981/.github`.** `ci-automation` infers the reusable workflow's internal `if:` from a comment, and prescribes SHA-pinning a repo whose contents were never inspected — while it currently receives `secrets: inherit`.
- **`ci-automation`'s "GITHUB_TOKEN suffices for all 12"** rests on a log line showing `Contents: write` in a job that failed at checkout. Well argued, but no failing workflow has actually pushed with `GITHUB_TOKEN`; only `mark-dead-games.yml` has.
- **`images-caching`'s central measurement generalises n=4 to 1,620 records.** The claim that `capsule_184x69.jpg` 404s for every hashed path — which drives the 68.8 MB figure, the Tier-A/Tier-B design, and the whole cost table — is 4 sampled URLs.
- **Line-number citations are unreliable across designs.** Verified myself: the `steam-headers` regex is at `vite.config.ts:94-95` (`images-caching` correct); `cloudflare-platform` cites `:99-108` for it and `:87-88` for the data `urlPattern` (actually `:82-83`). Both documents claim line-level verification, so a reader cannot trust either's citations without re-checking.
- **No design verified there is no test suite.** Confirmed: `web/package.json` has `dev/build/build:desktop/build:mobile/analyze/preview/typecheck/knip/tauri*` — no `test`, no `lint`. `knip` exists and is never run in CI.
- **`docs-legal`'s Privacy Policy asserts settings nobody checked** — "no Cloudflare Web Analytics, no Logpush, no Analytics Engine" is written as fact about an account state not yet configured.

---

## The five highest-value missing items

1. **A resolution of the `wrangler.jsonc` layout question** — it is the single decision that unblocks asks 5, 6, 7, and 14, and three designs assume three answers.
2. **A single owner-facing setup runbook** (ask 15) that merges the five orderings, breaks the CSP-hash cycle, and collects the ~13 by-hand owner actions.
3. **Any functional test or verification gate** — five framework majors, a new Worker, a new database, and a new write path into `main`, with `tsc -b && vite build` as the only check.
4. **A decision on what "new games" means** (ask 9), because one of the two designs does not satisfy the ask at all.
5. **Page-level UI design** (ask 3) — the token system is designed; the interface is not.