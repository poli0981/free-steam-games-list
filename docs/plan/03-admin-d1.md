# Admin Area + Cloudflare D1 Layer — Design

**Scope:** hidden admin UI, D1 schema, daily new-games queue, admin auth, Worker→Git write path.
**Model:** Git stays canonical (`data/*.jsonl`); D1 is a *work queue + drafts + audit*, never a source of truth for game records.

---

## 0. What I verified first (and one thing that isn't true yet)

Read: `web/src/lib/schema.ts`, `git-data.ts`, `edits.ts`, `github-api.ts`, `jsonl-shard.ts`, `cache.ts`, `fetcher.ts`, `data-store.ts`, `validation.ts`, `hooks/useIsOwner.ts`, `hooks/useCommitContext.ts`, `stores/auth.ts`, `stores/gpg.ts`, `lib/gpg.ts`, `App.tsx`, `components/layout/Sidebar.tsx`, `pages/{Add,Health,Activity}.tsx`, `components/games/{DiffViewer,BulkActionBar,EditGameDrawer}.tsx`, `vite.config.ts`, `web/package.json`, `scripts/{ingest_new,snapshot}.py`, `scripts/core/{constants,data_store,steam_client,health_checker,fetcher}.py`, and every workflow in `.github/workflows/`.

**The premise "a game discovered by the Python pipeline" does not currently hold.** There is no discovery step anywhere in `scripts/`. `grep -rn "applist\|GetAppList" scripts/` returns nothing; the only Steam endpoints called are `store.steampowered.com/api/appdetails`, `/appreviews/{appid}` and the player-count API (`E:\2\scripts\core\steam_client.py:95`, `:116`). `scripts/ingest_new.py:34` starts from `load_temp()` — i.e. `scripts/temp_info.jsonl` — which is populated by exactly three human/bot paths:

| Source | Entry point |
|---|---|
| Web "Add" page | `web/src/lib/edits.ts:440` `addLinks()` → commits `scripts/temp_info.jsonl` |
| Telegram bot | `.github/workflows/bot-ingest.yml` (appends links, then runs `ingest_new.py`) |
| GitHub issue `[add-game]` | `.github/workflows/ingest-from-issue.yml:20` |

So **section 2 below has to design the discoverer too**, not just the transport. This is the single biggest hidden scope item in this workstream.

Two more load-bearing facts from the code:

- `scripts/core/data_store.py:130-155` — `save_main()` **re-shards every record on every pipeline run** and `_save_index()` (`:158`) rewrites `data/index.json` with a fresh `now_iso()`. Consequence: the appid→shard mapping is not stable, and the pipeline already bumps `last_updated` for free. The Worker must locate records *by appid across all shards*, never by a client-supplied `flatIndex` (which is what `edits.ts:121` does today via `shardForFlatIndex`, guarded only by the "shard may have been re-balanced" error at `edits.ts:129-133`).
- Shards are 1.3–1.5 MB (`data/data_001.jsonl` = 1,526,699 bytes), so they exceed GitHub's 1 MB Contents-API limit. `getRepoFileText()` already handles the fallback to `/git/blobs/{sha}` (`web/src/lib/git-data.ts:97-128`). That code must come along to the Worker verbatim.

---

## 1. D1 schema

### 1.1 Modeling principle

Do **not** normalize the 28-field `GameRecord` (`web/src/lib/schema.ts:92-123`) into columns. It would be a second schema to keep in sync with `scripts/core/constants.py:63-77`, and D1 is not the record store. Instead:

- **Promote** only the columns you filter, sort, or dedupe on.
- Keep everything else as `payload_json TEXT`.
- `appid` is **derived** from `link` (`/\/app\/(\d+)/`, `web/src/lib/data-store.ts:10`, `scripts/core/data_store.py:26`). Compute it once at ingest, store it as a first-class column, and store `link` verbatim next to it — never re-derive in a query.
- Numeric-looking record fields are **formatted strings** (`"492,197"`, `"86% (Very Positive)"`, sentinel `"N/A"`). Store the raw string *and* a parsed integer companion for sorting. Parse with the same rules as `scripts/snapshot.py:26-37` (`_parse_players`, `_review_pct`) so the queue sorts the way the snapshot data does.
- Booleans are `INTEGER CHECK (x IN (0,1))`. `is_kernel_ac` is tri-state (`boolean | null`, `schema.ts:109`) → nullable INTEGER.
- All timestamps are `TEXT` in the pipeline's exact format `YYYY-MM-DDTHH:MM:SSZ` (`scripts/core/data_store.py:191`, mirrored in `edits.ts:29-31`). Lexicographic ordering equals chronological ordering — that's already relied on in `dedup_removed()` (`data_store.py:96`).

### 1.2 File layout wrangler expects

```
/wrangler.jsonc                      ← repo root (Workers Builds "root directory" = repo root)
/workers/api/
    src/
      index.ts                       ← router
      auth/access-jwt.ts
      auth/github-app.ts
      routes/{ingest,admin-queue,admin-drafts,admin-commit,admin-audit,admin-workflows}.ts
      git/commit.ts                  ← re-export of shared lib
      db/queries.ts
    migrations/
      0001_init.sql
      0002_seed_kv.sql
```

`wrangler.jsonc` (the *only* deploy config; no CI workflow, per the hosting decision):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "f2p-tracker",
  "main": "workers/api/src/index.ts",
  "compatibility_date": "2026-09-01",
  "workers_dev": false,                       // ← see failure mode S3
  "assets": {
    "directory": "web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/admin", "/admin/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "f2p-admin",
      "database_id": "<uuid>",
      "migrations_dir": "workers/api/migrations"
    }
  ],
  "triggers": { "crons": ["10 0 * * *"] },
  "observability": { "enabled": true }
}
```

> **Flag — verify:** Workers Builds does **not** run `d1 migrations apply` as part of a deploy. Migrations must be applied out-of-band (`npx wrangler d1 migrations apply f2p-admin --remote`) *before* the deploy that depends on them, or the Worker will throw `no such table` in production. Plan every migration as: apply migration → then push code. Never the reverse.

### 1.3 `migrations/0001_init.sql`

```sql
-- 0001_init.sql — F2P Tracker admin plane.
-- Git (data/*.jsonl) remains canonical. Nothing here is a source of truth for
-- game records; every table is a queue, a draft, or a log.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────
-- Ingest batches: one row per accepted POST /api/ingest/candidates.
-- `idempotency_key` UNIQUE is the replay guard; `response_json` is replayed
-- verbatim so a retrying GitHub Actions run sees the original outcome.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE ingest_batches (
  id               TEXT    PRIMARY KEY,           -- uuidv4
  idempotency_key  TEXT    NOT NULL UNIQUE,       -- "gh-<run_id>-<run_attempt>"
  body_sha256      TEXT    NOT NULL,              -- hex; 409 if key reused w/ different body
  source           TEXT    NOT NULL
                   CHECK (source IN ('github-actions','worker-cron','manual','telegram','issue')),
  run_id           TEXT,
  run_url          TEXT,
  generated_at     TEXT,                          -- producer clock
  received_at      TEXT    NOT NULL,              -- worker clock
  candidate_count  INTEGER NOT NULL DEFAULT 0,
  inserted_count   INTEGER NOT NULL DEFAULT 0,
  duplicate_count  INTEGER NOT NULL DEFAULT 0,
  rejected_count   INTEGER NOT NULL DEFAULT 0,
  response_json    TEXT    NOT NULL
) STRICT;

CREATE INDEX idx_batches_received ON ingest_batches(received_at DESC);

-- ─────────────────────────────────────────────────────────────
-- The daily new-games queue. One row per candidate appid per open decision.
-- Mirrors only the fields the review screen needs; the rest lives in payload_json.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE ingest_queue (
  id                     TEXT    PRIMARY KEY,
  appid                  TEXT    NOT NULL,        -- derived from link at ingest
  link                   TEXT    NOT NULL,        -- normalized: https://store.steampowered.com/app/<id>/
  name                   TEXT    NOT NULL DEFAULT '',
  header_image           TEXT    NOT NULL DEFAULT '',
  release_date           TEXT    NOT NULL DEFAULT '',
  description            TEXT    NOT NULL DEFAULT '',

  -- qualification evidence (why this is a candidate at all)
  app_type               TEXT    NOT NULL DEFAULT '',     -- steam "type": game/dlc/demo/music/video
  is_free                INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0,1)),
  health_status          TEXT    NOT NULL DEFAULT 'unknown',
                         -- ok|unavailable|not_found|coming_soon|not_free|network_error
                         -- (matches scripts/core/health_checker.py status codes)

  -- formatted strings kept verbatim + parsed companions for sorting
  reviews_raw            TEXT    NOT NULL DEFAULT 'N/A',
  reviews_pct            INTEGER,                          -- 0..100, NULL if unparseable
  current_players_raw    TEXT    NOT NULL DEFAULT 'N/A',
  current_players_num    INTEGER,
  metacritic_raw         TEXT    NOT NULL DEFAULT 'N/A',

  -- pipeline guesses; admin may override before approval
  genre_guess            TEXT    NOT NULL DEFAULT '',
  type_game_guess        TEXT    NOT NULL DEFAULT ''
                         CHECK (type_game_guess IN ('','online','offline')),
  tags_json              TEXT    NOT NULL DEFAULT '[]',
  platforms_json         TEXT    NOT NULL DEFAULT '[]',

  payload_json           TEXT    NOT NULL DEFAULT '{}',    -- full candidate blob, verbatim
  dup_hint_json          TEXT    NOT NULL DEFAULT '[]',    -- [{appid,name,score}] near-dupes

  batch_id               TEXT    REFERENCES ingest_batches(id) ON DELETE SET NULL,
  source                 TEXT    NOT NULL,

  status                 TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','deferred','approved','committed',
                                           'rejected','failed')),
  manual_overrides_json  TEXT    NOT NULL DEFAULT '{}',    -- MANUAL_FIELDS subset only
  reject_reason          TEXT
                         CHECK (reject_reason IS NULL OR reject_reason IN
                           ('not-a-game','not-free','dlc-or-demo','duplicate','region-locked',
                            'nsfw','junk','unhealthy','other')),
  defer_until            TEXT,
  decided_by             TEXT,                             -- Access email
  decided_at             TEXT,
  commit_job_id          TEXT    REFERENCES commit_jobs(id) ON DELETE SET NULL,

  first_seen_at          TEXT    NOT NULL,
  last_seen_at           TEXT    NOT NULL,
  seen_count             INTEGER NOT NULL DEFAULT 1
) STRICT;

-- At most one OPEN row per appid. Decided rows accumulate as history.
CREATE UNIQUE INDEX uq_queue_open_appid
  ON ingest_queue(appid)
  WHERE status IN ('pending','deferred','approved');

CREATE INDEX idx_queue_review    ON ingest_queue(status, first_seen_at DESC);
CREATE INDEX idx_queue_batch     ON ingest_queue(batch_id);
CREATE INDEX idx_queue_defer     ON ingest_queue(defer_until) WHERE status = 'deferred';
CREATE INDEX idx_queue_appid     ON ingest_queue(appid);

-- ─────────────────────────────────────────────────────────────
-- Long-term memory of decisions, so a rejected appid does not reappear daily.
-- Survives deletion/rollup of ingest_queue history.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE appid_decisions (
  appid           TEXT PRIMARY KEY,
  last_decision   TEXT NOT NULL CHECK (last_decision IN ('approved','rejected','deferred')),
  reason          TEXT,
  suppress_until  TEXT,                 -- ingest silently drops re-submissions before this
  decided_by      TEXT NOT NULL,
  decided_at      TEXT NOT NULL
) STRICT;

CREATE INDEX idx_decisions_suppress ON appid_decisions(suppress_until);

-- ─────────────────────────────────────────────────────────────
-- Edit drafts. patch_json matches EditPatch (web/src/lib/edits.ts:75-84) so
-- DiffViewer (web/src/components/games/DiffViewer.tsx:6-9) renders it unchanged.
-- Drafts live here, not localStorage, so they survive device switches.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE drafts (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL
                    CHECK (kind IN ('edit','replace','bulk_edit','bulk_delete','add')),
  appid             TEXT,                          -- NULL for bulk kinds
  appids_json       TEXT NOT NULL DEFAULT '[]',
  base_record_json  TEXT,                          -- snapshot when the draft was opened
  base_commit_sha   TEXT,                          -- repo HEAD when opened → staleness check
  patch_json        TEXT NOT NULL DEFAULT '{}',
  replacement_json  TEXT,                          -- full GameRecord, kind='replace' only
  note              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','submitted','committed','discarded','conflict')),
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  committed_at      TEXT,
  commit_job_id     TEXT REFERENCES commit_jobs(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_drafts_status ON drafts(status, updated_at DESC);
CREATE INDEX idx_drafts_appid  ON drafts(appid) WHERE appid IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Commit jobs. Stores INTENT, never serialized file content: the 1.4 MB shard
-- is re-read and re-serialized at run time, which is what makes retry-on-
-- conflict correct and keeps rows small.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE commit_jobs (
  id             TEXT    PRIMARY KEY,
  kind           TEXT    NOT NULL
                 CHECK (kind IN ('queue_approve','edit','replace','bulk_edit',
                                 'bulk_delete','add_links')),
  status         TEXT    NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','succeeded','conflict',
                                   'failed','cancelled')),
  intent_json    TEXT    NOT NULL,   -- {appids:[], patch:{}, entries:[], ...}
  paths_json     TEXT    NOT NULL DEFAULT '[]',  -- allowlisted paths this job may touch
  message        TEXT    NOT NULL,
  expected_head  TEXT,                            -- HEAD sha the job was planned against
  commit_sha     TEXT,
  commit_url     TEXT,
  verified       INTEGER CHECK (verified IS NULL OR verified IN (0,1)),
  verify_reason  TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  requested_by   TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
) STRICT;

CREATE INDEX idx_jobs_status ON commit_jobs(status, created_at);
CREATE INDEX idx_jobs_recent ON commit_jobs(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- Append-only audit log. Never UPDATEd, never DELETEd except by the retention
-- cron. Stores the Access email (identity) but NOT the client IP.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT    NOT NULL,
  actor        TEXT    NOT NULL,   -- "you@example.com" | "service:gh-actions" | "system:cron"
  actor_kind   TEXT    NOT NULL CHECK (actor_kind IN ('user','service','system')),
  action       TEXT    NOT NULL,   -- queue.approve | queue.reject | draft.commit | workflow.dispatch | ...
  entity_type  TEXT    NOT NULL CHECK (entity_type IN
                 ('queue','draft','game','workflow','batch','job','system')),
  entity_id    TEXT,
  appid        TEXT,
  before_json  TEXT,
  after_json   TEXT,
  commit_sha   TEXT,
  request_id   TEXT,               -- cf-ray
  ip_country   TEXT,               -- request.cf.country only — see privacy note
  ok           INTEGER NOT NULL DEFAULT 1 CHECK (ok IN (0,1)),
  detail       TEXT
) STRICT;

CREATE INDEX idx_audit_at     ON audit_log(at DESC);
CREATE INDEX idx_audit_actor  ON audit_log(actor, at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_appid  ON audit_log(appid) WHERE appid IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Small key/value scratch: discovery cursor, cache epoch, commit lock.
-- NOTE: no credentials here. See §5.1 on the installation token.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE kv_state (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

`migrations/0002_seed_kv.sql`:

```sql
INSERT INTO kv_state (k, v, updated_at) VALUES
  ('data_epoch',        '1',  strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('applist_cursor',    '0',  strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('last_discovery_at', '',   strftime('%Y-%m-%dT%H:%M:%SZ','now'))
ON CONFLICT(k) DO NOTHING;
```

> **Flag — verify before applying:** (a) `STRICT` tables require SQLite ≥ 3.37; D1's engine is well past that but confirm on your account. (b) Partial (`WHERE`-filtered) indexes are standard SQLite and should work, but `uq_queue_open_appid` is load-bearing for idempotency — test it explicitly with a duplicate insert before trusting it. (c) `commit_jobs` is referenced by `ingest_queue` and `drafts` before it is created in file order; SQLite resolves FKs lazily with `PRAGMA foreign_keys=ON` at runtime, but if D1's migration runner objects, reorder `commit_jobs` first. (d) Confirm D1's max row size against `payload_json` — keep candidate payloads under ~64 KB by dropping `description` to a truncated field and never storing full `language_details`.

### 1.4 Why no `games` table

Tempting, rejected. A mirror of 3,424 records in D1 would be a second copy that drifts the moment the Python pipeline commits (which it does daily, re-sharding everything). The admin UI already loads the full dataset client-side through `useGames()` (`web/src/hooks/useGames.ts:17-38`) with IndexedDB caching keyed on `index.last_updated` — that path works, costs D1 nothing, and cannot drift. The admin screens join D1 rows to in-memory records by `appid`.

---

## 2. Daily "new games" automation

### 2.1 The missing piece: discovery

New file `scripts/discover_new.py`, built on the existing primitives:

```
Steam ISteamApps/GetAppList/v2  →  ~250k {appid,name}
   minus  build_index(load_main()).keys()          (data_store.py:45-ish)
   minus  appids in scripts/removed_games.jsonl    (dedup_removed, data_store.py:85)
   minus  GET /api/ingest/suppressed  (appid_decisions.suppress_until)
   → delta, sorted by appid desc (newest first), sliced by --budget
   → for each: check_game_health(link, client)     (health_checker.py:47)
        drop NOT_FREE / COMING_SOON / NOT_FOUND / UNAVAILABLE
        keep OK  →  build candidate from health.data (the cached appdetails blob)
   → POST the survivors to the Worker
```

Reuse `SteamClient` as-is: it already throttles (`STORE_DELAY_MIN=1.2` in CI, `constants.py:23`), retries, and handles 429 with `Retry-After` (`steam_client.py:66-70`). The `check_game_health` → `HealthResult.data` reuse is the same double-fetch elimination `ingest_new.py:90` already relies on.

**Budget matters.** At ~1.5 s/request a 300-appid budget is ~8 minutes of wall clock — fine on a GitHub runner, impossible in a single Worker invocation. Persist a cursor (`kv_state.applist_cursor`) so consecutive days walk the backlog instead of re-scanning.

> **Flag — unverified:** the daily size of the GetAppList delta (it includes DLC, demos, soundtracks, videos, and test apps — likely hundreds to low thousands/day) and whether Steam rate-limits GetAppList itself. Start with `--budget 200`, measure for a week, then tune. Also unverified: whether `type == "game"` filtering on appdetails is sufficient to exclude playtests/betas.

### 2.2 Path (a) vs path (b)

| | (a) GH Actions → `POST /api/ingest/candidates` | (b) Cloudflare Cron Trigger crawls Steam |
|---|---|---|
| Reuses existing Python | Yes — `SteamClient`, `health_checker`, `data_store` unchanged | No — reimplement ~500 lines of throttling/retry/classification in TS |
| Fits the runtime | Yes — minutes of wall clock, no CPU cap concern | **No** — a Worker invocation cannot spend 8 minutes crawling; needs Queues or Durable Object alarms to fan out |
| Blocked by the expired `GH_TOKEN` PAT? | **No.** Only `actions/checkout` with `token: secrets.GH_TOKEN` fails (`ingest-new.yml:18`, `update-daily.yml:16`, `snapshot-daily.yml:12`). Discovery needs no push at all → check out with the default `secrets.GITHUB_TOKEN`, which demonstrably works (`mark-dead-games.yml` succeeds today) | No |
| Egress reputation vs Steam | GitHub runner IPs, already proven at 3,424-game scale | Cloudflare egress IPs are shared and heavily used; 429/geo-block risk (**unverified**) |
| Scheduling reliability | Actions cron drifts under load, can be delayed 5–30 min; disabled after 60 days repo inactivity (not a risk here) | Cron Triggers fire on time |
| Extra auth surface | One shared credential in GH secrets | None |

**Recommendation: (a) as the producer, (b) as a reconciler that never touches Steam.**

- `.github/workflows/discover-new.yml`, `cron: '5 0 * * *'`, `actions/checkout@v6` with **`secrets.GITHUB_TOKEN`** (not `GH_TOKEN`), `permissions: {contents: read}`, no push, no `concurrency: data-write` group needed (it writes nothing to the repo).
- Worker cron `10 0 * * *` does only: expire `deferred` rows past `defer_until`; re-read `data/index.json` from `raw.githubusercontent.com` and flip `approved`→`committed` for appids that actually landed; write a `system:cron` heartbeat to `audit_log`; raise a banner in the admin UI if `kv_state.last_discovery_at` is older than 36 h (that's how you find out the Actions cron silently stopped).

The decisive argument is the PAT: routing discovery through D1 **decouples the daily new-games flow from the broken credential entirely**. It keeps working even while `Auto Update JSON Data`, `Update Reviews`, `Top Online`, `Check Dead Links`, `Purge Unhealthy` and `Anti-Cheat List` are all failing. (Approval still needs the repo write path — see §5 — but *seeing* the queue does not.)

### 2.3 Endpoint contract

```http
POST /api/ingest/candidates HTTP/1.1
Host: free-steam-games.win
Content-Type: application/json
CF-Access-Client-Id: <service-token-id>.access
CF-Access-Client-Secret: <service-token-secret>
Idempotency-Key: gh-<run_id>-<run_attempt>
X-F2P-Timestamp: 1789564800
X-F2P-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + rawBody)>
```

Auth is **layered on purpose**: the Access service token gets the request past the edge (revocable in the Zero Trust dashboard, logged, no code change to rotate); the HMAC proves the *body* wasn't tampered with and pins it to a 300 s window. If you skip Access service tokens, replace the two `CF-Access-*` headers with `Authorization: Bearer <INGEST_SECRET>` compared with a constant-time equality — but keep the HMAC either way.

Body:

```json
{
  "source": "github-actions",
  "run_id": "18234771902",
  "run_url": "https://github.com/poli0981/free-steam-games-list/actions/runs/18234771902",
  "generated_at": "2026-09-11T00:09:44Z",
  "cursor": { "applist_position": 2481930 },
  "candidates": [
    {
      "link": "https://store.steampowered.com/app/3210450/",
      "appid": "3210450",
      "name": "Example Arena",
      "header_image": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3210450/header.jpg",
      "description": "…",
      "release_date": "10 Sep, 2026",
      "app_type": "game",
      "is_free": true,
      "health_status": "ok",
      "reviews_raw": "N/A",
      "current_players_raw": "N/A",
      "metacritic_raw": "N/A",
      "genre_guess": "Action",
      "type_game_guess": "online",
      "tags": ["Shooter", "PvP"],
      "platforms": ["windows"]
    }
  ]
}
```

Notes on the shape: field names match `GameRecord` (`schema.ts:92-123`) where they exist, `*_guess` where the pipeline is guessing something an admin will confirm, and `*_raw` where a formatted string is being carried verbatim. `appid` is sent explicitly *and* re-derived server-side from `link`; a mismatch is a hard 400 (that's a corrupted producer, not a recoverable case).

**Server-side validation (non-negotiable):**
- `link` must match `^https://store\.steampowered\.com/app/\d+/$` after `normalizeLink()` semantics (`data-store.ts:16-24`). Anything else → reject that candidate, don't 400 the batch.
- `header_image` host must be in `{shared.akamai.steamstatic.com, cdn.akamai.steamstatic.com, steamcdn-a.akamaihd.net}`; otherwise blank it.
- `name`/`description` length-capped (200 / 2000) and stored as text only.
- `candidates.length ≤ 500`, raw body ≤ 1 MB → else `413`.

**Idempotency, two layers:**
1. `ingest_batches.idempotency_key UNIQUE`. On replay with the same `body_sha256`, return `200` with the stored `response_json` plus `"replayed": true`. On replay with a *different* body hash → `409 idempotency_key_reused`.
2. `uq_queue_open_appid` partial unique index. A candidate whose appid already has an open row → counted as `duplicate`, and `last_seen_at`/`seen_count` bumped (useful signal: "still showing up on day 5, still not reviewed"). A candidate whose appid is in `appid_decisions` with `suppress_until > now` → counted as `suppressed`.

**Responses:**

```json
200 {"batch_id":"…","replayed":false,"received":143,"inserted":37,
     "duplicates":9,"suppressed":91,"rejected":[{"appid":"…","reason":"bad-link"}],
     "queue_depth":58,"suppressed_appids_etag":"…"}
401 {"error":"unauthorized"}                 // no detail — never say which check failed
400 {"error":"malformed","detail":"candidates[3].link"}
409 {"error":"idempotency_key_reused"}
413 {"error":"payload_too_large","max_candidates":500}
429 {"error":"rate_limited","retry_after":3600}   // >4 batches/day from one source
507 {"error":"queue_full","queue_depth":1000}     // stop accepting until reviewed
```

Add `GET /api/ingest/suppressed?since=<iso>` (same service auth) so `discover_new.py` can prune before spending appdetails calls. Cheap, and it keeps the suppression list out of the repo.

### 2.4 "Within a day" timeline

```
00:05 UTC  discover-new.yml fires (GITHUB_TOKEN checkout, no push)
00:05–00:13  ~200 appdetails calls at ~1.5 s each
00:13 UTC  POST /api/ingest/candidates  →  rows land in ingest_queue (status='pending')
00:10 UTC  Worker cron reconciles yesterday's approvals, expires defers, heartbeats
any time   admin opens /admin/queue  →  "N new today"  →  approve/reject
on approve →  commit to scripts/temp_info.jsonl  →  push triggers ingest-new.yml
           →  ingest_new.py enriches  →  save_main() re-shards + bumps index.json
           →  SPA cache invalidates (isCacheFresh, web/src/lib/cache.ts:43)
```

**Hard dependency to state plainly:** the approve step is a no-op until `ingest-new.yml:18` stops using the expired `secrets.GH_TOKEN`. Either the owner rotates the PAT, or that workflow switches to `secrets.GITHUB_TOKEN` (which works today — proven by `mark-dead-games.yml`), or the Worker's App token dispatches the workflow directly (§5.4). Recommend all three eventually; at minimum the second, immediately.

---

## 3. Admin authentication

### 3.1 Recommendation: Cloudflare Access, and retire the PAT model entirely

| | Cloudflare Access | Current PAT model (`useIsOwner` + localStorage) |
|---|---|---|
| Where enforced | At the edge, deny-by-default, *before* the Worker or any asset is served | In React, client-side; the real check is GitHub rejecting the write |
| Credential at rest in the browser | Short-lived JWT in an HttpOnly cookie the page cannot read | A **long-lived repo-write PAT in plain `localStorage`** (`github-api.ts:10`, `:26-28`) |
| XSS impact | Session cookie unreadable by JS; blast radius bounded by session lifetime | Full repo write, exfiltratable by one `localStorage.getItem('f2p:gh_token')` |
| Revocation | Instant, per-user, in Zero Trust | Revoke the PAT on GitHub, then hope no copy survives |
| MFA / IdP | Yes (Google, GitHub OIDC, one-time PIN) | No |
| Audit | Per-request Access logs + your `audit_log` | None |
| Failure mode already observed | — | Expiring PATs is exactly what broke every scheduled workflow in this repo |

The PAT model's own comment concedes it is cosmetic: *"we hide the UI to keep the experience unambiguous for non-owners"* (`web/src/lib/schema.ts:11-14`) and *"Random visitors signed in with their own PATs would also fail the server-side push permission check"* (`useIsOwner.ts:2-5`). That's honest, and it's fine when the only server is GitHub. It stops being fine when a Worker holds a repo-write credential — then the SPA's client-side check is standing in front of a real privileged backend.

**Decision: Access for the perimeter, JWT verification in the Worker for authority, no GitHub credential in any browser.**

### 3.2 Access configuration

Two applications, both deny-by-default (Access always is):

| App | Path | Policy | Session |
|---|---|---|---|
| `f2p-admin-ui` | `free-steam-games.win/admin` and `/admin/*` | Allow → Emails: `<owner email>` (Include), require IdP | 24 h |
| `f2p-admin-api` | `free-steam-games.win/api/admin/*` | Same emails **plus** a Service Auth policy is *not* added here | 24 h |
| `f2p-ingest` | `free-steam-games.win/api/ingest/*` | Service Auth → the `discover-new` service token only | n/a |

Most-specific path wins, so `/api/ingest/*` being its own app does not inherit the human-email policy from `/api/admin/*`.

### 3.3 Exactly how the Worker validates the JWT

```ts
// workers/api/src/auth/access-jwt.ts
const TEAM   = env.CF_ACCESS_TEAM;             // "<team-name>"  (no protocol)
const ISS    = `https://${TEAM}.cloudflareaccess.com`;
const JWKS   = `${ISS}/cdn-cgi/access/certs`;
const AUD_UI = env.CF_ACCESS_AUD_ADMIN;        // Application Audience tag, 64-hex
const AUD_SVC= env.CF_ACCESS_AUD_INGEST;
```

Steps, in order, all mandatory:

1. Read the token from the **`Cf-Access-Jwt-Assertion` request header**; fall back to the `CF_Authorization` cookie for navigations. Treat both as attacker-controlled input until verified — Cloudflare strips/overwrites the header on proxied traffic, but a direct hit to an unproxied origin would not.
2. Parse the JOSE header. **Reject any `alg` other than `RS256`.** Never accept `none`, never let the token pick the algorithm family.
3. Fetch JWKS from `${ISS}/cdn-cgi/access/certs`, select by `kid`. Cache the key set in a module-global with a **1 h TTL and an unknown-`kid` refetch** (Cloudflare rotates Access signing keys ~every 6 weeks; a permanently cached JWKS is a scheduled outage).
4. Verify the signature (`crypto.subtle.importKey('jwk', …, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'})` + `crypto.subtle.verify`, or `jose`'s `createRemoteJWKSet` + `jwtVerify`, which runs in Workers).
5. Verify claims: `iss === ISS` **exactly**; `aud` contains the AUD tag for *this specific app* (`AUD_UI` for `/api/admin/*`, `AUD_SVC` for `/api/ingest/*`); `exp > now`; `nbf <= now`; `iat` within a sane skew.
6. **Application-level allowlist on top:** `payload.email` must be in `env.ADMIN_EMAILS` (comma-separated). This is not redundant — it is the control that survives someone widening the Access policy by accident.
7. For the ingest app, the JWT carries `common_name` (the service token's client ID) rather than `email`; assert it equals `env.INGEST_SERVICE_TOKEN_ID`.

> **Flag — verify:** the exact claim name for service tokens (`common_name`) and whether service-token JWTs include `sub`/`email` at all. Test with a real token before relying on step 7; if the claim shape differs, keep the HMAC from §2.3 as the actual proof and treat Access as transport-level gating only.

Step 5's `aud` check is the one people skip. Without it, **a valid Access JWT minted for any other application in the same Zero Trust team authenticates to your admin API.**

### 3.4 What happens to each existing file

| File | Fate |
|---|---|
| `web/src/hooks/useIsOwner.ts` (17 lines) | Rewritten, not deleted. Becomes `useIsAdmin()` → a TanStack Query against `GET /api/admin/me`, returning `{email, isAdmin}` derived from the verified JWT. Server truth, not GitHub identity. Only the admin entry imports it. |
| `web/src/stores/auth.ts` (108 lines) | **Deleted.** With it, `f2p:gh_token` / `f2p:gh_user`. |
| `web/src/lib/github-api.ts` | Gutted. Delete `loadAuth`/`saveAuth`/`clearAuth` (`:18-33`), `fetchUser` (`:51`), `checkRepoAccess` (`:63`), `putContents` (`:125`), `dispatchWorkflow` (`:164`). Keep `getRecentWorkflowRuns` (`:210`) only if the public Activity page still calls it token-lessly — better, proxy it (§6). |
| `web/src/hooks/useCommitContext.ts` (68 lines) | **Deleted.** It exists solely to derive `{author, signer}` for browser-side commits; both move server-side. |
| `web/src/stores/gpg.ts`, `web/src/lib/gpg.ts`, `components/auth/GpgPanel.tsx`, `GpgQuickUnlock.tsx`, `hooks/useGpgAutolock.ts`, `web/src/gpgauth/` | **Removed from the web path** (see §3.5). |
| `web/src/lib/oauth-device.ts`, `components/auth/DeviceFlowPanel.tsx`, `AuthPanel.tsx`, `VITE_GH_OAUTH_CLIENT_ID`, `VITE_GH_OAUTH_PROXY` | **Deleted.** The CORS proxy requirement disappears with the whole flow. |
| `web/src/lib/edits.ts` (515 lines) | Split. The pure shard-mutation logic (`applyPatch`, the parse/mutate/serialize bodies, `bumpedIndexFile` at `:45-66`) moves to shared code the Worker imports. The `token`-taking exported functions are replaced by `fetch('/api/admin/…')` calls. |
| `web/src/lib/verify-commit.ts` | Dropped from the client. `createCommit` already returns `verification.{verified,reason}` (`git-data.ts:264-278`); the Worker records it into `commit_jobs.verified` and the UI reads the job. |
| `web/src/lib/optimistic.ts` | Kept, repointed. Its whole reason for existing — the 5-minute Fastly TTL on `raw.githubusercontent.com` (`optimistic.ts:1-15`) — is unchanged. |

**Migration cleanup that is easy to forget:** returning visitors have a live repo-write PAT sitting in `localStorage` under `f2p:gh_token`, and possibly an armored private key under `f2p:gpg_armored`. Ship a one-time purge on app boot (`main.tsx`, before render) that removes `f2p:gh_token`, `f2p:gh_user`, `f2p:gpg_armored`, `f2p:gpg_autolock_min`, `f2p:gpg_preferred_uid`, and shows a one-time notice telling the owner to revoke that PAT on GitHub. Deleting the code does not delete the credential from users' browsers.

### 3.5 Does the armored GPG key in localStorage survive? No.

It cannot, and shouldn't. `useCommitContext` (`:35-52`) only produces a signer when the key is unlocked *in the browser that is committing*; once the Worker commits, there is no browser in the loop. Three options:

**Option A — GitHub-signed commits via GraphQL `createCommitOnBranch` (recommended).** GitHub signs commits created through that mutation server-side; they show as Verified. It also takes `expectedHeadOid`, giving you atomic compare-and-swap instead of the read-then-`updateRef` race in `git-data.ts:329-372`. Cost: the author is the App/token identity, not a human — acceptable and arguably more honest for a bot-mediated approval.
> **Flag — verify:** confirm both the auto-signing behavior *and* whether it holds for GitHub App installation tokens specifically, before you delete the OpenPGP code. Test with one throwaway commit and inspect `commit.verification` via `GET /repos/{o}/{r}/commits/{sha}`.

**Option B — sign in the Worker with OpenPGP.** `signCommitContent()` (`gpg.ts:103-124`) is pure Web Crypto/JS with no DOM dependency and would run in a Worker; the armored key + passphrase become Worker secrets. Keeps the existing "Verified with the owner's key" identity and reuses `buildCommitContent()` (`git-data.ts:232-242`) with its hard-won byte-exactness (`:213-231`) and the `nonDeterministicSignaturesViaNotation: false` workaround (`gpg.ts:96-101`). Cost: the private key now lives in Cloudflare's secret store instead of the owner's browser — a *better* custody story than `localStorage`, but it means a Cloudflare account compromise yields a signing key.
> **Flag — verify:** openpgp v6 in the Workers runtime (module bundling, no Node built-ins). Likely fine; test early because it gates the choice.

**Option C — unsigned commits from the App token.** Simplest, and the Activity page already renders an "unsigned" badge gracefully (`Activity.tsx:199-202`).

Pick A, keep B as the documented fallback, and either way **delete the browser-side key storage**. If the owner still wants a personally-signed local workflow, that belongs in a git checkout on his machine, not in a web page.

---

## 4. "Hiding" the admin page — what that actually means

Say the quiet part first: **client-side hiding is obfuscation, not access control.** Anyone can read the built JS, enumerate route strings, and call `/api/admin/*` directly with curl. The only thing standing between a stranger and your data is the Worker rejecting requests without a valid Access JWT. Everything in this section is about not *advertising* the surface and not shipping admin code to strangers — not about security.

That said, there is a meaningful difference between "hidden in the public bundle" and "never served to unauthenticated clients", and this design takes the stronger option.

**4.1 Separate entry, not a lazy route.** Build the admin as a second Vite entry (`web/admin.html` → `web/dist/admin/index.html`) rather than a `lazyWithRetry` route inside `App.tsx:76-110`. Reason: a lazy route still puts the chunk's URL in the public entry's dynamic-import map and in the Vite manifest, so the admin JS is fetchable by anyone who reads the main bundle. A separate entry produces a separate asset graph that the public `index.html` never references.

**4.2 Access in front of the path, and the Worker serving it.** With `not_found_handling: "single-page-application"`, an unmatched `/admin/anything` would otherwise fall back to the **public** `index.html`. So `run_worker_first: ["/admin", "/admin/*", "/api/*"]` and the Worker handles it:

```ts
if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
  const id = await verifyAccessJwt(request, AUD_UI);   // throws → 302/401
  return withNoIndex(await env.ASSETS.fetch(new Request(new URL('/admin/index.html', url), request)));
}
```

This is the only variant where the admin HTML is genuinely gated — Access refuses the request at the edge, and even a request that somehow reaches the Worker (see failure mode S3) is refused again.

**4.3 What an unauthenticated visitor sees at `/admin`:** a `302` to `https://<team>.cloudflareaccess.com/cdn-cgi/access/login/...`, i.e. the Cloudflare Access login screen. That reveals your team domain and nothing else — no app content, no JS, no API shape. If even that is unwanted, drop the Access self-hosted app on `/admin` and have the Worker return a bare `404` for non-JWT requests, using Access only on `/admin/login`. I'd keep the redirect: a 404 that becomes a working page when you have a cookie is a worse experience and no more secure.

For `/api/admin/*`, **return `401 {"error":"unauthorized"}` as JSON, not a login redirect** — `fetch()` follows redirects opaquely and the SPA would parse the login HTML as JSON. The SPA treats 401 as "session expired" → full-page reload to `/admin` so the browser can do the Access redirect dance.

**4.4 `noindex`.** Worker adds `X-Robots-Tag: noindex, nofollow, noarchive` to every `/admin*` and `/api/*` response. Do **not** add `Disallow: /admin` to `robots.txt` — that file is public and would advertise the path. Access-gated pages can't be crawled anyway.

**4.5 No nav entry.** Remove `{ to: "/add", …, ownerOnly: true }` from `SECONDARY` in `web/src/components/layout/Sidebar.tsx:64-71`, and the `visibleSecondary` filter at `:106`. With the PAT gone, `isOwner` is always false in the public bundle, so the concept disappears rather than becoming dead code. Admin nav lives inside the admin entry only.

**4.6 The service worker will break this if you let it.** `vite.config.ts:76` sets `navigateFallback` to the public `index.html`. Once a visitor's SW is installed, an `/admin` navigation is answered *from cache* with the public shell and never reaches Cloudflare. Required:

```ts
navigateFallbackDenylist: [/^\/admin/, /^\/api\//],
// and no runtimeCaching rule may match /api/* — admin JSON must never be cached
```

Also drop the `404.html` `globIgnores` comment and the `/free-steam-games-list/` base while you're in there (hosting workstream).

**4.7 Tauri: compile the admin out.** `web/package.json:12-13` builds desktop/mobile with `--base /` from the same source. The Access login flow does not work cleanly inside a Tauri webview (the cookie lands in a system-browser context the webview doesn't share), and `web/src-tauri/tauri.conf.json` currently sets `security.csp: null`, so any injected content in that shell runs with `tauri-plugin-http` privileges. Guard the admin entry behind `VITE_ADMIN_BUILD` and never set it for `build:desktop` / `build:mobile`. **Admin is web-only.** State that in the docs so it isn't discovered as a bug later.

---

## 5. Worker → Git on approval

### 5.1 Credential: GitHub App, not a PAT

Use a GitHub App installed on `poli0981/free-steam-games-list` only, with `Contents: read & write`, `Metadata: read`, and `Actions: read & write` (needed for `workflow_dispatch`, §5.4).

- The App's RSA private key (PKCS#8) is a Worker secret. The Worker mints a 10-minute RS256 JWT with `crypto.subtle.importKey('pkcs8', …, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'})`, exchanges it at `POST /app/installations/{id}/access_tokens` for a **1-hour installation token**, and caches that token **in a module-global (per-isolate) with `exp - 60s`, or in the Cache API — never in D1.** A bearer token in a D1 row is a credential sitting in a database that several code paths can read; the isolate global costs one extra mint per cold start.
- Why not a fine-grained PAT: it expires (max ~1 year), it's bound to a human account, and **the expiring-PAT failure mode is precisely what has taken down every scheduled workflow in this repo**. Repeating it in the Worker would mean the site's write path silently dies on a date nobody wrote down. If you go PAT anyway: add a Worker cron that calls `GET /rate_limit` and writes an `ok=0` `audit_log` row on 401, so you find out in the admin UI instead of from a user.

### 5.2 Reusing `git-data.ts` verbatim

`web/src/lib/git-data.ts` is **already Worker-portable**. It uses only `fetch`, `TextEncoder`/`TextDecoder`, `btoa`/`atob` (`:15-20`, `:76-80`) — all present in the Workers runtime. No DOM, no React, no localStorage. Concretely:

- Move `git-data.ts`, `jsonl-shard.ts`, `schema.ts`, and the `extractAppid`/`normalizeLink`/`migrateRecord` parts of `data-store.ts` into `shared/` (or leave them in `web/src/lib/` and import across the tree — Wrangler's esbuild bundle will follow the relative import, **provided Workers Builds' root directory is the repo root** so both `web/` and `workers/` exist in the build context. That's a hard constraint on the hosting workstream's Workers Builds configuration).
- `commitFiles()` (`:325-374`) takes `token: string` — pass the installation token, nothing else changes.
- `updateBranchRef(sha, token, force = false)` (`:281`): in the Worker, **hard-wire `force` and delete the parameter.** A force-push from an automated approval path can silently erase a pipeline commit.
- The `signer` hook (`:314`, `:348-358`) becomes unused under §3.5 Option A, or is wired to the Worker-side OpenPGP under Option B.
- `getRepoFileText()`'s 1 MB Contents-API fallback (`:97-128`) is **required**, not optional — every real shard exceeds 1 MB.

**Preferred primary path: GraphQL `createCommitOnBranch`** with `expectedHeadOid`, which collapses blob→tree→commit→updateRef into one atomic request with built-in CAS and server-side signing. Keep the ported `commitFiles()` as the fallback for payloads the mutation rejects.

### 5.3 The write algorithm (and conflict handling)

```
claimJob()                          -- UPDATE commit_jobs SET status='running'
                                    --   WHERE id=? AND status='queued'  → check meta.changes
for attempt in 1..3:
  head        = getHead(token)                      // git-data.ts:48
  indexText   = getRepoFileText('data/index.json')  // fresh, always
  targetShard = findShardContaining(appid)          // scan shards by appid,
                                                    //   NOT shardForFlatIndex()
  newContent  = applyIntent(freshShardText, job.intent_json)   // re-apply the PATCH
  indexFile   = bumpedIndexFile(indexText, deltas)             // edits.ts:45-66 port
  try:
    result = commit(files=[shard, indexFile], parent=head.commitSha, message=job.message)
    break
  except RefAdvanced (422 / expectedHeadOid mismatch):
    sleep(250ms * 2^attempt + jitter);  continue
else:
  status='conflict'   -- park for manual retry; DO NOT force
```

Four things this gets right that the browser version doesn't:

1. **Never trusts a client-supplied `flatIndex`.** `edits.ts:121` maps `flatIndex → shard` through `shardForFlatIndex` (`jsonl-shard.ts:7-19`) using a possibly-stale in-browser manifest. Since `save_main()` re-shards everything (`data_store.py:130`), that mapping can be wrong within minutes of a pipeline run. Scan shards for the appid with `findRecordIndexByAppid` (`jsonl-shard.ts:50-58`) instead — 5 shard fetches worst case, cached per job.
2. **Re-applies the intent, not a pre-serialized file.** `commit_jobs.intent_json` holds `{appids, patch}`, so a retry after a concurrent pipeline commit preserves the pipeline's changes to *other* records in the same shard. This is the same reasoning as `bulkEditGames`'s per-shard refetch (`edits.ts:265-282`), made durable.
3. **Path allowlist.** The Worker may only write `data/data_*.jsonl`, `data/index.json`, `scripts/temp_info.jsonl`, `scripts/removed_games.jsonl`. Any other path → job fails. Critically this excludes `.github/workflows/**` — a Worker with contents:write that accepts a client-supplied path is remote code execution via CI (see S2).
4. **One writer at a time.** All commits serialize through a single Durable Object (`CommitQueue`), or, if you'd rather avoid DOs, a D1 claim (`UPDATE … WHERE status='queued' RETURNING`) plus a `kv_state('commit_lock')` row with a timestamped lease. Concurrent commits to the same branch is how you get 422 storms and half-applied bulk edits. This is the Worker-side equivalent of the repo's existing `concurrency: {group: data-write}` discipline — which, note, `snapshot-daily.yml` is currently missing.

**Retry budget:** 3 attempts, then `status='conflict'` and the job shows in `/admin/jobs` with a Retry button and the current HEAD sha. Better a visible stall than a silent overwrite. The browser version's single blind retry (`commitFileWithRetry`, `git-data.ts:397-406`) is not enough for a path that will race a daily pipeline.

### 5.4 What "approve" actually commits

**Do not write a shard record directly.** Append to `scripts/temp_info.jsonl` exactly as `addLinks()` does (`edits.ts:474-512`), one JSON object per line with `link` plus any MANUAL_FIELDS overrides — that's precisely what `parse_entries()` (`ingest_new.py:23-30`) and `merge_extension_data()` (`ingest_new.py:82-95`) consume, and the manual overrides are re-applied after fetch (`ingest_new.py:92-94`) so they survive the daily refetch. The Python pipeline stays the only thing that constructs a full `GameRecord`, so there is exactly one place where the schema lives.

The push to `scripts/temp_info.jsonl` triggers `ingest-new.yml` via its path filter (`ingest-new.yml:6`). Belt and braces: also `POST /repos/{o}/{r}/actions/workflows/ingest-new.yml/dispatches` with the App token — the same call `dispatchWorkflow()` makes (`github-api.ts:164-181`), now server-side with a workflow-file allowlist.

Edits to *existing* records do write shards directly (that's what `updateGame`/`bulkEditGames` already do), plus the `index.json` bump.

### 5.5 `index.json.last_updated` — the cache-invalidation contract

Bump it on **every** data commit. It is the sole freshness signal for:
- `isCacheFresh()` (`web/src/lib/cache.ts:43`) → IndexedDB `f2p:records` / `f2p:index`
- `useGames()`'s reload decision (`web/src/hooks/useGames.ts:20-27`)

Port `bumpedIndexFile()` (`edits.ts:45-66`) byte-for-byte, including `JSON.stringify(next, null, 2) + "\n"` (`:65`) — that matches `_save_index()`'s `json.dump(..., indent=2)` + trailing newline (`data_store.py:167-173`), so Worker commits and pipeline commits produce identical formatting and the diffs stay one-line-clean. Preserve `max_per_file` and per-shard `count` deltas exactly as the bulk-delete path does (`edits.ts:379-384`).

Two additions for the Cloudflare world:
- Bump `kv_state('data_epoch')` on every successful commit, expose it at `GET /api/meta`, and have the SPA append `?v=<epoch>` to shard fetches. That defeats the 5-minute Fastly TTL on `raw.githubusercontent.com` documented in `optimistic.ts:1-15` — the problem `optimistic.ts` currently papers over client-side.
- If the hosting workstream ever proxies `data/*` through the Worker, the same epoch is the cache-key namespace; purge is then a counter increment, not an API call.

---

## 6. Admin UI surface

### 6.1 What moves

| Component | Today | After |
|---|---|---|
| `pages/Add.tsx` (750 lines) | Public route `/add`, gated by `useIsOwner` (`:53`) with a visitor branch (`:66-84`), GPG badges (`:99-108`), calls `addLinks()` directly | `/admin/add`. Delete the visitor branch and GPG badges outright. `POST /api/admin/queue/manual {links[]}` — manual adds now land in the same queue as discovered ones, so there's one review surface |
| `components/games/EditGameDrawer.tsx` | Opened from the public games table | Admin entry only. Public `GameDetailDrawer.tsx:67` loses its `isOwner` edit affordance entirely |
| `BulkEditDrawer.tsx`, `BulkActionBar.tsx` | `BulkActionBar` already `return null`s for non-owners (`:44`) | Admin entry only; the null-guard becomes unnecessary |
| `DiffViewer.tsx` (64 lines) | Edit confirmation | Reused **unchanged** in three places: edit confirm, queue "edit-then-approve" preview, and draft review. Its `{before, patch}` props (`:6-9`) map 1:1 onto `drafts.base_record_json` / `drafts.patch_json` |
| `pages/Health.tsx` (299 lines) | One page, mixed | **Split.** `gatherIssues()` + the issue cards (`:37-80`, `:139-178`) stay public at `/health` (they're derived from public data and are genuinely useful). The "Maintenance triggers" card (`:180-254`) with its seven `dispatchWorkflow` buttons moves to `/admin/ops` and posts to `POST /api/admin/workflows/:file/dispatch` |
| `pages/Activity.tsx` (215 lines) | Public, optionally token-authed (`:37-49`) | Stays public, drops the token param. **Proxy it**: `GET /api/activity` with `cf: {cacheTtl: 60}` — unauthenticated GitHub API is 60 req/h/IP, and without a token every visitor's page load spends one. A new `/admin/activity` overlays `audit_log` + `commit_jobs` on the commit list, so you see "approved by X at 09:14 → job abc → commit `4f2c1ab` (Verified)" |

New admin-only: `/admin/queue`, `/admin/drafts`, `/admin/jobs`, `/admin/audit`, `/admin/ops`, `/admin/add`.

### 6.2 `/admin/queue` — "New games today"

**Header strip.** Today / last 7 days / all-pending selector · counts by status · **"Last batch: 4 h ago from github-actions (run #18234771902)"** — this is the line that tells you the Actions cron died, and it earns its pixels. Queue depth with a warning past 200.

**Row.** Capsule thumbnail (via `headerToCapsule()` semantics from `web/src/lib/image.ts`, routed through the Worker image transform per the hosting workstream) · name · appid · Steam link · release date · qualification evidence (`app_type=game`, `is_free=true`, `health_status=ok`) · guessed genre/type · tag chips · **duplicate warning** from `dup_hint_json` (name-similarity against the 3,424 existing records, computed **in the Worker at ingest time** — never in the browser over a 5.9 MB dataset).

**Per-row actions.**
- **Approve** — takes the guesses as-is.
- **Approve with edits** — opens `components/games/edit/EditFormFields.tsx` restricted to `MANUAL_FIELDS` (`schema.ts:24-32`: `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `notes`, `type_game`, `safe`, `genre`), because everything else will be overwritten by `fetch_full()` anyway. The result is stored as `manual_overrides_json` and becomes the extra keys on the `temp_info.jsonl` line — closing the loop with `merge_extension_data()` cleanly.
- **Reject** — with the `reject_reason` enum, which writes `appid_decisions.suppress_until = now + 365d` so it never comes back.
- **Defer** — snooze N days; the Worker cron un-defers.

**Bulk.** Select-all-visible (same pattern as `BulkActionBar.tsx:50-61`), bulk approve/reject with a single confirm, **one commit, one `commit_jobs` row, one audit batch**. Approving 40 games should be 40 lines in one commit, not 40 commits.

**Keyboard.** `j/k` move, `a` approve, `r` reject, `e` edit, `d` defer, `⌘↵` commit. Reviewing 30 candidates should take two minutes; if it takes fifteen, the queue will silently stop being reviewed and the whole feature dies.

**Commit preview (before anything is written).** Show the literal `scripts/temp_info.jsonl` lines to be appended, the `DiffViewer` table for any edits, the exact commit message, and the target branch. Nothing commits until **"Commit N approvals"**. Then a job card with live status → commit sha + Verified badge, or a conflict with a Retry button.

**Empty state.** "No new candidates today. Last batch received 4 h ago from github-actions." + a **Run discovery now** button (dispatches `discover-new.yml`). An empty queue and a broken producer must not look the same.

### 6.3 `/admin/drafts` and `/admin/audit`

- **Drafts** — open edits not yet committed, resumable across devices because they live in D1 rather than a browser. Each shows a staleness badge when `base_commit_sha` ≠ current HEAD, with "the record changed underneath this draft — re-base or discard".
- **Audit** — filter by actor / action / appid / date; every row links to its commit sha where one exists. This is the human-readable half; Git history is the tamper-evident half.

---

## 7. Security failure modes of this design

Honest list, worst first.

**S1 — The Worker holds a repo-write credential.** Any unauthenticated path that reaches the commit function is total repo compromise. Mitigations: a single `requireAdmin(request)` choke point that every `/api/admin/*` route passes through *before* routing (not per-handler, where one new handler forgets it); the §5.3 path allowlist; branch pinned to `main`; force-push impossible. **Never accept a file path or commit message verbatim from the client** — the path allowlist is what stops `.github/workflows/evil.yml` from being committed, which would be RCE-by-CI with `contents:write`.

**S2 — Access is bypassable via `*.workers.dev`.** A zone-scoped Access application does **not** cover the Worker's `workers.dev` hostname. `workers_dev: false` in `wrangler.jsonc` closes it, but the real defense is that **the Worker verifies the JWT itself** — which is why §3.3 is mandatory rather than defense-in-depth. Same applies to any preview/version URL Workers Builds generates. Audit those.

**S3 — JWT verification bugs.** In descending likelihood: not checking `aud` (any Access app in your team then authenticates); not checking `iss`; caching JWKS forever across key rotation (a scheduled outage, not a breach); accepting the algorithm from the token header; trusting `Cf-Access-Jwt-Assertion` without verifying it, which is the classic hole because the header *looks* like it came from Cloudflare.

**S4 — Access path-matching gaps.** `/admin` does not cover `/api/admin`. An app scoped to `/admin` and a Worker that assumes Access covers everything = an open admin API. Test with curl against every `/api/admin/*` route with no cookie and no header. Automate it.

**S5 — Ingest credential leak.** The service token (or shared secret) lives in GitHub Actions secrets; a workflow bug that echoes it (`bot-ingest.yml`'s final step already interpolates `secrets.BOT_TOKEN` into a shell command line at `if: always()`) leaks it into public logs. Blast radius is bounded — a leaked ingest credential can only *propose* candidates, which are inert until approved — but a poisoned candidate is a phishing vector aimed at exactly one person. Mitigations: HMAC + 300 s timestamp window; batch caps; `queue_full` backpressure; and §2.3's server-side `link`/`header_image` validation.

**S6 — Stored XSS through candidate fields.** `name`, `description`, `notes` come from Steam via an intermediary. React escapes text nodes, but `link` rendered as `<a href>` accepts `javascript:` and `header_image` as `<img src>` accepts arbitrary hosts (data exfil via referrer / SSRF-ish through the image-transform Worker). Validate both server-side at ingest, and again at render. Never `dangerouslySetInnerHTML` anywhere under `/admin`.

**S7 — D1 quota exhaustion as DoS.** Free tier is 100 K row-writes/day and since 2026-09-01 over-limit queries **hard-fail** — an attacker (or a runaway retry loop) who reaches `/api/ingest` can take the admin plane down until 00:00 UTC. Mitigations: Workers Paid (you're on Pro — confirm the Worker is on the paid plan, not just the account); per-source batch rate limits; no writes on any unauthenticated path. Separately, `audit_log` grows without bound toward the 5 GB cap — add a retention cron (365 days) and roll old rows into a monthly summary.

**S8 — Approval races and double-commits.** Two admin tabs approving the same row → two `temp_info.jsonl` lines. `ingest_new.py:58` dedupes by appid so damage is bounded, but the state machine must still use conditional updates (`UPDATE … WHERE status='pending'` + check `meta.changes`) rather than read-then-write.

**S9 — Idempotency-key reuse with a different body** silently diverges the queue from what the producer thinks it sent. Hash the body; `409` on mismatch.

**S10 — Lockout.** If the Access IdP (or the one-time-PIN email) fails, there is no second admin path, and the Git write path is only reachable through it. **Break-glass, documented explicitly:** the owner edits `data/*.jsonl` directly on github.com. This works *because* Git stays canonical — which is the strongest argument for the hybrid model and should be written into the runbook, not left as folklore.

**S11 — Cloudflare account compromise rewrites the audit log.** `audit_log` is only as trustworthy as the Worker that writes it. Git history is the independent, externally-hosted, tamper-evident record — another reason to keep every mutation flowing through a commit, and a further argument for signed commits (§3.5).

**S12 — Privacy policy becomes false.** `audit_log` stores an email address and a country per admin action. `docs/PRIVACY_POLICY.md` and `docs/EULA.md` currently assert "no backend, no server-side log". That is already flagged in the brief; this workstream is one of the things that makes it false, and the legal/docs workstream needs the specifics: identity stored = Access email; retention = 365 days; no IP addresses; no visitor data (public pages hit no D1 table and write no log row).

**S13 — Migration-order footgun.** Workers Builds deploys code on push; it does not apply D1 migrations. A push that adds a query for a not-yet-created column produces a production `no such column` with no rollback. Enforce: migrations first, always, and make additive-only changes (new nullable columns, never renames) so an old Worker version and a new schema coexist.

---

## 8. Open items to confirm before implementation

1. `createCommitOnBranch` auto-signing with a **GitHub App installation token** (gates §3.5's Option A vs B).
2. `STRICT` tables and partial unique indexes in D1; D1 max row size vs `payload_json`.
3. Access **service-token JWT claim shape** (`common_name` vs `sub`) for §3.3 step 7.
4. openpgp v6 in the Workers runtime (only if Option B is chosen).
5. Steam GetAppList daily delta volume and rate limits → sets `--budget`.
6. Whether Workers Builds' root directory can be the repo root while `assets.directory` is `web/dist` and the build command is `cd web && npm ci && npm run build` — this is a shared assumption with the hosting workstream and both designs break if it isn't true.
7. `free-steam-games.win` does not currently resolve from this machine (no A/AAAA). DNS is a prerequisite for the Access apps, which are configured per-hostname.
8. `ingest-new.yml:18` still uses the expired `secrets.GH_TOKEN`. **The approve→ingest loop does not work until that's fixed** (rotate the PAT, or switch to `secrets.GITHUB_TOKEN` as `mark-dead-games.yml` already does). This is the CI workstream's item, but it is a blocking dependency for this one.