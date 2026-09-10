# RISK REVIEW — seven designs, adversarial

Verified against `E:\2` at `dd6532ea`. Read-only; no files changed.

The one structural property that makes everything below survivable: **Git stays canonical**. Every data-loss scenario here is recoverable because `data/*.jsonl` lives in a repo with history that Cloudflare cannot touch. Do not let any design erode that — and note that two of them quietly do (R2, R3).

---

## CRITICAL

### R1 — Three designs specify three mutually incompatible Worker layouts. The first one to land silently breaks the other two.

| Design | `wrangler.jsonc` at | Builds root | `main` | `assets.directory` | `workers_dev` |
|---|---|---|---|---|---|
| cloudflare-platform | `web/` | `web` | `./worker/index.ts` | `./dist` | **enabled** (rollback target) |
| images-caching | repo root (per its file list) | unstated | `worker/index.ts` | `./dist` | unstated |
| admin-d1 | repo root | **repo root** | `workers/api/src/index.ts` | `web/dist` | **`false`** |

**Verified:** `ls package.json` → *no root `package.json`*. Workers Builds detects the package manager from a lockfile in the root directory. admin-d1's repo-root layout has no lockfile at root, so dependency install is not auto-detected — and admin-d1's own open item #6 concedes "both designs break if it isn't true." It isn't.

images-caching's block is internally inconsistent: at repo root, `"main": "worker/index.ts"` and `"directory": "./dist"` resolve to `/worker/index.ts` and `/dist`, neither of which exists. First build fails.

**Failure scenario:** admin-d1 lands first with a repo-root config. Workers Builds installs nothing, `vite` is not on PATH, build fails. Someone "fixes" it by adding `cd web && npm ci &&` to the build command, which then breaks the asset path resolution. Two days of dashboard archaeology on a config that has no CI representation to diff against.

**Mitigation:** Freeze `web/wrangler.jsonc` as a **single artifact owned by one person**, before any other work. Use cloudflare-platform's layout (the only one compatible with the lockfile reality), with admin-d1's `workers_dev: false` and `/admin`, `/admin/*` prefixes folded into `run_worker_first`. No other design may redefine it; they contribute route handlers to `web/worker/routes/` only.

---

### R2 — `bumpedIndexFile()` strips unknown keys from `index.json`. Two designs add keys to that file. One of them makes it a site-wide outage.

**Verified** at `web/src/lib/edits.ts`:

```js
const next = {
  max_per_file: obj.max_per_file ?? 800,
  total: newTotal,
  last_updated: nowIsoSeconds(),
  files: newFiles,          // newFiles = files.map(f => ({ name: f.name, count: ... }))
};
```

Every top-level key that isn't one of those four, and every per-file key that isn't `name`/`count`, is **deleted on write**. admin-d1 §5.5 says to port this "byte-for-byte" into the Worker — which faithfully ports the bug into the new privileged write path.

Two designs write to that file:
- **images-caching §2(a)** puts a content hash on each `files[]` entry (`data_001.<sha8>.jsonl`) and adds `core`/`detail` arrays. The entire content-addressing scheme — `Cache-Control: immutable`, `CacheFirst` in Workbox, per-shard IndexedDB keys — depends on that `sha` surviving.
- **docs-legal §1.8** adds `license`, `license_url`, `attribution` (and flags this exact risk in its own appendix, correctly).

**Failure scenario (images-caching):** owner makes one routine edit through the web UI. `sha` vanishes from all five file entries. The SPA constructs `/data/data_001.undefined.jsonl` → the Worker's SPA fallback returns `index.html` with `200 text/html` → the JSONL parser receives `<!doctype html>` and throws a parse error with no useful message. Every visitor, immediately, with no alert. Recovery requires a hand-edited commit to `index.json` — while the previously-working shard URLs are pinned `immutable, max-age=31536000` in every browser and every edge PoP.

**Severity: Critical.** Silent, one-click, site-wide, triggered by the single most routine owner action.

**Mitigation (all three):**
1. Rewrite `bumpedIndexFile` to **spread** rather than reconstruct — `{...obj, last_updated, total, files: obj.files.map(f => ({...f, count: ...}))}` — *before* anyone adds a key. This is a 3-line change and it is a prerequisite for both docs-legal §1.8 and images-caching §2.
2. Add a CI assertion that `data/index.json` round-trips through the bump function with zero key loss.
3. **Never make a URL depend on a field a hot write path can delete.** If you want content addressing, put the hash in a query string (`data_001.jsonl?v=<sha8>`), so a missing hash degrades to a cache miss, not a 404. This alone converts R2 from Critical to cosmetic.

---

### R3 — "Serve `data/` from `dist/`" and "exclude `data/**` from build watch paths" cannot both be true. One combination freezes the dataset silently.

- **images-caching §4** recommends shipping `data/` inside `dist/` — "versioned by the same Git commit as the code that parses it."
- **cloudflare-platform §5.8** sets watch paths to `Include: web/*`, and states plainly: "a data-only commit will explicitly NOT redeploy. That is correct and intentional."
- **ci-automation §1.7** independently reaches the same conclusion: "the Worker's build watch paths **must exclude** `data/**`."

**Failure scenario:** images-caching's data-in-`dist` lands; cloudflare-platform's watch paths land. The daily pipeline commits `data/**` and nothing else. No build triggers. The site serves the last-built snapshot indefinitely. Because `index.json.last_updated` also comes from `dist/`, the client's freshness check compares stale-to-stale and reports the cache as **fresh**. There is no error, no alert, and `pipeline-health.yml` (ci-automation §2.3) checks `last_updated` in *Git*, not in *production* — so it reports green. You find out when someone mentions a game from three weeks ago is missing.

**Severity: Critical** — silent staleness with an actively misleading health check.

**Mitigation:** pick one, in writing, in `DEPLOYMENT.md`:
- **(a) Recommended.** Data stays on `raw.githubusercontent.com` behind the Worker proxy (cloudflare-platform §2.2) with 60s/300s edge TTL. Watch paths exclude `data/**`. Data cadence is decoupled from deploys. Cost: one cross-origin fetch from the edge, cached.
- **(b)** Data ships in `dist/`; watch paths **must include** `data/**` and you accept ~30 builds/month plus the loss of the "data commit is free" property.

Either way: `pipeline-health.yml` must assert freshness by fetching **production**, not by reading the repo. That single change catches this class of failure regardless of which option wins.

---

### R4 — Image transformation cost: the two designs disagree by 3×, both undercount, and there is no spend ceiling in Cloudflare.

cloudflare-platform: 460-only, `IMG_TRANSFORM=false` default → worst case 3,424/mo.
images-caching: three variants, Tier-A passthrough → floor 1,620, worst case 8,466 → "$4.23/mo".

Both miss three multipliers:

1. **Format branching doubles the unique count.** images-caching's own handler picks `format` from the `Accept` header (`webp` or `jpeg`). A unique transformation is (source × option set). Two formats = two option sets = **2× uniques for every image any non-WebP client touches**. One old Safari, one curl, one scraper with a bare `Accept: */*` and the whole catalog is billable twice.
2. **`?t=` is Valve's asset mtime.** When a publisher updates artwork mid-month, the source URL changes and mints a fresh unique. Steam art churn across 3,424 games is not zero.
3. **Workers Paid does not include Images.** The user is on Workers Pro. That grants exactly nothing here — Images Paid is a separate subscription. Neither design says the 5,000-free allowance survives on a paid Workers plan; it is a distinct meter.

**Failure scenario:** design C ships with `format: auto`-style branching. A scraper (or Googlebot, or a link-preview crawler) walks the sitemap and touches every `/img/d2/...`. 3,424 sources × 3 variants × 2 formats = ~20,500 uniques in one afternoon. There is **no billing cap in Cloudflare Images**; you learn the number from the invoice.

**Mitigation, in order and non-negotiable:**
1. The **appid allowlist** (images-caching §1.3, `appids.bin`) ships in the *first* `/img/*` deploy, not as a hardening pass. Without it the endpoint is a paid amplifier pointed at 200,000+ Steam apps.
2. **Pin `format` to exactly one value.** Serve non-WebP clients an *un-transformed passthrough*, never a second transform option set.
3. Ship month one with transforms **off** (`IMG_TRANSFORM=false` / Tier-A passthrough only). Read the real `/img/*` volume from Workers Logs. Enable transforms only with a number in hand.
4. Cloudflare Notification at **3,000** uniques, not 4,000 — the counter is monthly and you need lead time to flip the kill switch.
5. Treat images-caching's **design D (pre-generate to R2 in the Python pipeline)** as the plan of record if month-one volume exceeds 3,000. It is structurally $0 and removes the entire unbounded-cost surface. The 120 lines of Pillow code are cheaper than the tail risk.

---

## HIGH

### R5 — D1 free-tier is an availability cliff with 24-hour recovery, and nobody has confirmed which plan the database is on.

admin-d1's S7 names it; the mitigation is "confirm the Worker is on the paid plan." Nobody confirms it anywhere. Since 2026-09-01, over-limit queries on Free **hard-fail** — not throttle.

**Failure scenario:** the hourly reconciler (admin-d1 §2.2/§8.6) is specified two ways: "select `added_at >= now-36h`" in one place, "re-read `data/index.json` and shards and flip `approved`→`committed`" in another. The second reads all 3,424 records. A retry loop or a misconfigured cron turns that into 100K row-writes before lunch. Every admin query then fails until 00:00 UTC — **including the queries you'd use to diagnose it**, and including the approval path, so the daily queue stops being reviewable for a day.

**Mitigation:**
- Confirm the D1 billing plan **before writing migration 0001**, recorded in `DEPLOYMENT.md`.
- The reconciler is a **bounded delta query only**. Never a full-table upsert. Assert the bound in code (`LIMIT 500`), not in a comment.
- The `audit_log` retention prune ships **in migration 0001**, not "later." A monotonically growing table with a 5 GB ceiling and no prune job is a scheduled outage.
- Rate-limit `/api/ingest` at the Worker *before* it touches D1, so a retry storm burns CPU, not the daily write budget.

---

### R6 — The origin change destroys the GPG private key, and one design's cleanup step is what destroys it.

**Verified** `web/src/stores/gpg.ts:38` — `const armoredFromStorage = localStorage.getItem("f2p:gpg_armored")` at module scope. Different origin, gone.

cloudflare-platform §6.3 says export before the tombstone. admin-d1 §3.4 says ship "a one-time purge on app boot that removes `f2p:gh_token`, `f2p:gh_user`, **`f2p:gpg_armored`**, …". These land from different workstreams.

**Failure scenario:** the purge ships to the *old* origin (or before the owner exports). The armored secret key is deleted from the only place it exists. Every future commit is unsigned; the `verify-commit` badge in Activity permanently reads "unsigned"; and if the key was also the identity used anywhere else, that's unrecoverable.

Adjacent, worse, and unmentioned by any design: the **minisign private key** behind `tauri.conf.json`'s `pubkey: 9F39774AE5453C53`. Lose that and the desktop auto-updater is **permanently dead for every already-installed copy** — there is no recovery path that doesn't involve every user manually reinstalling.

**Mitigation:**
- Manual export of the armored GPG key **with written confirmation** is a hard prerequisite gating the tombstone, the purge, and the `deploy-pages.yml` deletion.
- The purge must (i) run only on `free-steam-games.win`, (ii) **never delete `f2p:gpg_armored`** — show a banner and let the human do it. Automated deletion of a private key is the wrong default under every circumstance.
- Before any of this: confirm an offline backup of both the GPG secret key and the minisign secret key exists. If it doesn't, that's the first task in the whole program.

---

### R7 — Moving the repo-write credential into a Worker while keeping `workers.dev` enabled defeats the entire access model.

cloudflare-platform §1.2 keeps `f2p-tracker.<sub>.workers.dev` live "as the rollback/preview target." admin-d1 §S2 identifies exactly that hostname as the Access bypass. They are describing the same URL and disagreeing about whether it should exist.

Worse, and unaddressed: Workers Builds mints **public preview URLs for every non-production branch** (`versions upload` — cloudflare-platform §5.7 lists this as a *benefit*). A zone-scoped Access application on `free-steam-games.win` covers **none** of them.

**Failure scenario:** a feature branch preview of the admin Worker holds a live GitHub App installation token (Contents: write, Actions: write). The preview URL leaks via a PR comment, a screenshot, or Certificate Transparency. Combined with any of admin-d1's own S3 JWT gaps — missing `aud` check being the classic — that's unauthenticated repo write. Path allowlist absent or bypassed → commit `.github/workflows/pwn.yml` → CI RCE with `contents: write` and access to every repo secret.

**Mitigation, all of them:**
- `workers_dev: false`. Non-negotiable, and it settles R1's contradiction in the same stroke.
- **Do not use branch previews for the admin Worker.** Either split admin routes into a second Worker with previews disabled, or add an Access application covering `*.workers.dev` for the account.
- `requireAdmin(request)` at the **router**, before dispatch — never per-handler, where the next handler forgets it.
- Path allowlist as a literal anchored regex (`^data/data_\d{3}\.jsonl$|^data/index\.json$|^scripts/temp_info\.jsonl$|^scripts/removed_games\.jsonl$`), rejecting anything containing `..`, and **verified by a test**.
- Pick a rollback story that is not workers.dev (see R11).

---

### R8 — The force-push parameter still exists, and `main` has no ruleset protecting it.

**Verified** `web/src/lib/git-data.ts:284,291` — `updateBranchRef(sha, token, force = false)`, `force` passed straight into the update-ref body. ci-automation independently verified that the only GitHub ruleset in the repo targets **tags**, not branches.

admin-d1 §5.2 correctly says "hard-wire `force` and delete the parameter" — but it's one bullet inside a long section, not a gate.

**Failure scenario:** the conflict-retry path parks a job at `status='conflict'` with a "Retry" button (admin-d1's own design). Someone adds a "force retry" for a stuck job. One click erases whatever the ~115-minute `Update Reviews` run committed in between — up to a day of scraped data across four shards. Recoverable from reflog only if noticed inside 90 days.

**Mitigation:** delete the parameter from the shared module **before** the Worker imports it, and add a GitHub **branch ruleset on `main` blocking force pushes**. The ruleset costs nothing and moves this from "unlikely" to "impossible."

---

### R9 — Four framework majors converge with a host migration, two designs order them differently, and `npm install` is currently broken.

deps-security: router 7 → React 19 → i18next 26 → Tailwind 4 → TS → Tauri/CSP, with `HashRouter` **kept** until the Worker is live.
ui-welcome step 4: react-router 7 **plus the BrowserRouter flip in the same commit**.

The bundled version makes a routing regression and a dependency regression indistinguishable, and couples the frontend upgrade train to the DNS schedule.

Underneath all of it: **`npm install` in `web/` fails today** with ERESOLVE (`echarts@6.1.0` vs `echarts-wordcloud@2.1.0` peer `^5.0.1`). deps-security found this and it is the single highest-leverage blocker in the program. Everything downstream depends on it: every upgrade stage, every Dependabot PR, the new `web-ci.yml` gate — **and Workers Builds' own dependency install**. If Workers Builds runs `npm install` rather than `npm ci`, **the very first Cloudflare build fails** for a reason with nothing to do with Cloudflare, on the day you're trying to prove the migration works.

**Mitigation / ordering change:**
1. **Stage zero, before anything else:** verify the word cloud renders on echarts 6 in production today (`#/charts/tags`). If blank, replace the chart. Then land the `echarts-wordcloud` peer override. Nothing proceeds until `npm install` exits 0.
2. Then: lockfile refresh → `cargo update -p quinn-proto` → **react-router 7 on `HashRouter`** → React 19 → i18next 26 → Tailwind 4.
3. **Then** hosting cutover.
4. **Then** `HashRouter`→`BrowserRouter` as a single-line commit, separately revertable.
5. **Then** the Tauri release. Never ship a desktop/Android binary in the same week as a router change — a routing regression in a shipped binary is not hotfixable.

---

### R10 — Deleting `deploy-pages.yml` removes the only typecheck gate, and its replacement is scheduled last.

**Verified:** `deploy-pages.yml` is the sole runner of `npm run typecheck` and `npm run build` — and it does `npm ci || npm install`, which silently papers over lockfile/manifest drift (exactly the state the repo is in).

ci-automation §9 puts `web-ci.yml` in PR 5 of 5, alongside the Pages deletion. The four framework-major PRs land before it.

**Failure scenario:** a React 19 type error merges to `main` during the upgrade train. Nothing catches it. You discover it from a Cloudflare dashboard build failure days later, on a commit that is now buried under three more.

**Mitigation:** `web-ci.yml` is **PR 0**. It requires nothing from Cloudflare. Drop `|| npm install` in the same commit (after R9 stage zero, or `npm ci` is the only thing that works). Make it a required status check on `main`.

---

### R11 — Rollback after cutover is theoretical, and one step is irreversible for a year.

The stated rollback — "re-enable `deploy-pages.yml` from git history and push" — assumes a world that no longer exists by then: `base` is `/` (Pages needs `/free-steam-games-list/`), `404.html` is deleted, `navigateFallback` changed, `HashRouter` gone, data fetches point at `/api/data/*` which only the Worker serves, and the Pages origin is a self-destroying tombstone. That's a multi-file revert of a merged upgrade train, executed under pressure.

Meanwhile HSTS at `max-age=31536000` + `includeSubDomains` (cloudflare-platform §5.5) is **irreversible for a year** for everyone who received the header.

**Mitigation:**
- HSTS starts at `max-age=300` and **stays there for a week** of verified operation. `includeSubDomains` off until you're certain no subdomain will ever need plain HTTP. `preload` never, until the domain is settled for months.
- The real rollback is a **Cloudflare deployment rollback to the previous Worker version**. Write that runbook and rehearse it once against a preview before cutover.
- **Keep the Pages site serving the real app for 30 days** after the Worker is live. The tombstone is the point of no return — it goes *last*, not at step 6 of 8. Order: Worker live and verified → 30 days dual-serving → tombstone → delete `deploy-pages.yml` + `notify-deploy.yml`.

---

## MEDIUM

### R12 — SPA fallback turns every missing asset into `200 text/html`, and four mechanisms depend on getting a 404.

deps-security found it for chunk loading (`isChunkLoadError` regex doesn't match Chrome's *"Expected a JavaScript module script but the server responded with… text/html"*). It applies equally to: relative `favicon.svg` / `icon-192.svg` / `qr/*.png` under deep routes (cloudflare-platform §4.4), `/img/*` if `run_worker_first` is misconfigured (images-caching §1.5), and any `.jsonl` fetch after a shard rename (R2).

Every failure mode is **silent**: 200 OK, no console error, wrong bytes.

**Mitigation:** `run_worker_first` covers `/assets/*` and `/data/*` with an explicit 404 for unknown paths. Add the MIME-type string to the chunk-error regex. Make every asset URL root-absolute **in the same commit** as `base: "/"` — this is a checklist, and checklists get half-done.

### R13 — The hash shim must ship in the same deploy as `base: "/"`, and CSP will block it if inline.

Every `#/games/730` link in `games/*.md`, in the Telegram bot's messages, in `bug_report.yml`, and in every bookmark and shared link depends on it. If the shim lands a deploy late — or lands inline and gets blocked by the new `script-src 'self'` — those all land on the Dashboard. Nobody reports "wrong page"; they just stop clicking. **External file, hash or `'self'`, same deploy, verified against all six legacy shapes.**

### R14 — Commit the snapshot concurrency block *first*, as a one-liner.

**Verified:** `snapshot-daily.yml` has no `concurrency:` block and `bash/snapshot.sh` pushes. ci-automation catches this — but its fix rewrites the file to use a composite action that doesn't exist yet *and* moves the cron. If the file is committed as-is (it's currently untracked) before the restructure, you have added a racing writer against three 115-minute jobs. Add `concurrency: {group: data-write, cancel-in-progress: false}` to the existing file as its own commit, before any of ci-automation's restructuring.

### R15 — The description-truncation commit is a 3,424-record rewrite that is irreversible in practice.

It must hold `data-write`; it invalidates every client's IndexedDB at once (5.9 MB re-download × every visitor); and the pre-truncation text is only recoverable from Steam, which may have changed it. If it lands the same day as cutover, the new domain's first impression is a cold 6 MB fetch. **Own commit, own day, after cutover, one shard's diff reviewed by hand first.** Also confirm `description` truncation happens in exactly one place (`fetcher.py`) or you get flip-flopping diffs between paths.

### R16 — Access is a single point of lockout, and the break-glass loses queue state.

admin-d1's S10 break-glass ("edit `data/*.jsonl` on github.com") works **only because Git stays canonical** — good. But the queue, drafts and audit live only in D1, so a lockout loses workflow state, not just access. Add a second Access identity (second email, or a one-time-PIN backup policy), and confirm `wrangler d1 execute --remote` from a local machine works as the true break-glass — that path doesn't traverse Access at all.

### R17 — The Access service token expires in a year: the exact failure currently being recovered from.

ci-automation flags it. But its health check calls `/api/admin/health` **using the token it's checking**, so an expired token yields "unhealthy" with no cause. Have the endpoint return the token's remaining lifetime so the alert fires 30 days early and says why.

### R18 — `ingest-from-issue.yml` is an unauthenticated write path into `main`, live today.

No `author_association` gate; any public user opens an issue titled `[add-game]`, their fenced JSON is written to `scripts/temp_info.jsonl`, committed and pushed with `contents: write`. ci-automation found it and correctly rates it above the `&&`/`||` bug in the same file. **Fix it in the same PR as the GH_TOKEN deletion** — it is independent of every other workstream and there is no reason to wait.

### R19 — Three designs, three different CSPs, and two of them break the app in ways that only appear in a packaged build.

deps-security's Tauri policy is the only one that includes `ipc:` / `http://ipc.localhost` (omit → **every `invoke()` fails silently**, including `shell:open` and the OAuth device flow) and `style-src-attr` (omit → **every React `style={{}}` is dropped**, layout collapses). cloudflare-platform's `_headers` CSP omits `style-src-attr`. images-caching's Tauri note covers only `img-src`.

Neither failure appears in `tauri dev`. **One CSP owner. `Content-Security-Policy-Report-Only` on web for a full deploy cycle. Manual smoke test of a packaged desktop build before any release tag.**

### R20 — Two inline scripts now need CSP hashes, and both fail silently on a byte change.

ui-welcome's theme bootstrap must be inline to kill the FOUC; the hash shim must be inline-ish to run before React. Both need `sha256-` hashes in both the Worker CSP and the Tauri CSP, kept byte-identical across builds. A one-character change to either breaks first paint (theme) or every legacy link (shim), reported only as a CSP violation in a console nobody reads. **Prefer external files for both**; the extra request is cheaper than this bug class.

---

## LOWER

- **R21** — cloudflare-platform's `og:image` SVG→PNG fix is correct, but nobody has generated the PNG. Shipping the URL before the asset exists turns a blank card into a broken one. Ship asset and URL together or neither.
- **R22** — admin-d1's `STRICT` tables, partial unique indexes, and forward FK references are all flagged unverified *by its own author*, and D1 migrations apply **out-of-band before deploy**. A half-applied migration leaves a schema the new code assumes. Make 0001 idempotent, apply to a scratch D1 first, and make every subsequent migration additive-only (new nullable columns, never renames) so old Worker versions coexist with new schema.
- **R23** — ci-automation's `git pull --rebase --autostash` on 800-line JSONL shards: a real conflict is not resolvable in a runner. It correctly `::error::`s rather than picking a winner. **Keep that. Resist any future `-X ours`.**
- **R24** — the `f2p-data-v2`→`v3` rename stops stale entries being *served* but leaves them occupying quota. `sw-cleanup.js` must ship in the **first** new-origin deploy, or users carry both caches.

---

## Revised sequencing (the ordering changes that remove the most risk)

```
 0. Fix `npm install` (echarts-wordcloud peer override) — everything blocks on this
 0. web-ci.yml as a required check; drop `npm ci || npm install`
 0. Delete `token: secrets.GH_TOKEN` (12 files) + gate ingest-from-issue.yml + delete
    bot-ingest.yml:194-202  ← independent of Cloudflare, fixes a live outage and a
    live unauthenticated write path
 0. snapshot-daily.yml concurrency block, one-line commit
 0. Confirm offline backups of the GPG secret key AND the minisign secret key
 0. Fix bumpedIndexFile() to spread rather than reconstruct
 0. Branch ruleset on `main` blocking force pushes; delete the `force` param

 1. Freeze web/wrangler.jsonc as one owned artifact (workers_dev: false)
 2. Lockfile refresh + cargo update; router 7 on HashRouter; React 19; i18next; Tailwind 4
 3. Decide data-serving (proxy vs dist) and watch paths, in writing, together
 4. Worker live on a preview; /img/* with the appid allowlist and transforms OFF
 5. Cutover; HSTS at max-age=300; Pages keeps serving the real app
 6. +7 days: HSTS to a year.  +30 days: tombstone, then delete deploy-pages.yml
 7. BrowserRouter flip (one line) + hash shim, same deploy
 8. Admin/D1 (plan confirmed, migrations applied out-of-band first)
 9. Tauri release with CSP, tested as a packaged build
10. Description truncation, its own day
```

The four items that most change the risk profile, if you only do four: **fix `bumpedIndexFile` before adding keys to `index.json`** (R2), **appid allowlist in the first image deploy with transforms off** (R4), **`workers_dev: false` and no admin previews** (R7), and **keep Pages serving the real app for 30 days instead of tombstoning at cutover** (R11).