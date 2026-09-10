I have everything I need. Here is the design.

---

# `scripts/discover_new.py` — design

Everything below is grounded in the code I read and in endpoint probes I ran during this review. Measured numbers are marked **[measured]**; guesses are marked **[unverified]**.

## 0. What I verified against the live store (this session)

| Probe | Result |
|---|---|
| `count=200` on the search endpoint | returns **100** rows — server caps page size at 100 **[measured]** |
| `?query=` (what `requests` emits from `params={"query": ""}`) vs `?query&` | identical: `success:1`, `total_count:16668` **[measured]** — no need to hand-build the query string |
| `start=20000` (past end) | `success:1`, **0 rows**, `start` clamped to 16667 → the page loop terminates naturally **[measured]** |
| `appdetails?appids=a,b` (multi-id) | **HTTP 400**. Batching is gone; one call per appid **[measured]**. Note `SteamClient._get` maps 400 → `None` → `fetch_app_details_full` → `("network_error", None)` (`scripts/core/steam_client.py:81`, `:99-100`) |
| Search row markup | each row carries `data-ds-appid`, `class="title"`, `class="search_released"` (e.g. `10 Sep, 2026` or `Coming soon`), and `data-price-final="0"` **[measured]** |
| Bundles on this query | `data-ds-bundleid` and `data-ds-packageid` counts were **0**, no comma ids on page 0 — `category1=998` already excludes them. Keep the comma guard anyway; it costs one `in` test **[measured]** |
| `supportedlang=english` | dropping it raises `total_count` 16,668 → **18,205** (+1,537, 8.4%) **[measured]** |
| Search "Coming soon" vs appdetails | appid `5033550` showed **"Coming soon"** in search and `coming_soon: false, date "10 Sep, 2026"` in appdetails minutes later **[measured]**. The search text lags — usable as a *this-run* skip, never as a durable rejection |
| Date format inconsistency | same batch returned `"Sep 10, 2026"` and `"10 Sep, 2026"` **[measured]**. Carry `release_date` verbatim as a string; never parse it (the skeleton stores it as a string anyway, `scripts/core/data_store.py:201`) |

### The backlog, measured

I intersected search pages against the 3,424 appids in `E:\2\data\data_*.jsonl` (newest `added_at` = `2026-06-30T16:03:21Z`):

| offset | release window | unknown |
|---|---|---|
| 0–99 | 10 Sep – 31 Aug 2026 | 100 / 100 |
| 100–599 | 31 Aug – 1 Jul 2026 | 495 / 500 |
| 600–699 | 1 Jul – 22 Jun 2026 | **20 / 100** |
| 700–799 | 22 Jun – 10 Jun 2026 | 10 / 100 |
| 1000 | May 2026 | 19 / 100 |
| 3000 | Jul/Aug 2025 | 78 / 100 |
| 6000 | Jun/Jul 2024 | 87 / 100 |
| 10000 | Jun/Jul 2022 | 93 / 100 |
| 14000 | Apr/May 2019 | 87 / 100 |

**This is the single most important finding for the design: there are two different backlogs, not one.**

1. **Time backlog** — offsets 0 to ~650, everything released since the pipeline stopped on 2026-06-30. **~625 candidates**. The known-ratio flips hard at offset 600 (0% known → 80% known), exactly where `added_at` stops. One 20-minute run clears it.
2. **Historical long tail** — offsets ~1,000 to 16,668, titles the catalogue never covered. **~12,000–13,000 candidates**, ~6–7 hours of `appdetails`. This is a separate policy decision (do you want 2013-era free games that `mark_dead_games.py` will immediately flag?), an explicitly dispatched job, and never the daily cron's business.

Release rate in the recent window: 100 rows spans 10–12 days at every sample point → **~8–9 new free English-supporting titles per day [measured]**. The daily run is tiny.

---

## 1. The discovery sweep

### Endpoint access: one additive change to a core module

`SteamClient` has no search method and the script must not bypass the shared throttle clock. Add one method to `E:\2\scripts\core\steam_client.py`, inserted after `fetch_store_page` (`:142-151`), changing nothing that exists:

```python
    def fetch_search_page(self, start: int, count: int = 100) -> Optional[dict]:
        """Store search, newest free games first. Returns the parsed JSON
        ({'success', 'results_html', 'total_count', 'start'}) or None.

        This is the only discovery-capable endpoint on this client: every other
        method needs an appid you already have. It deliberately shares
        _throttle_store with fetch_app_details_full, so search pages and
        appdetails calls draw on ONE rate budget rather than two.
        """
        resp = self._get(
            "https://store.steampowered.com/search/results/",
            params={
                "query": "",
                "start": start,
                "count": count,      # server caps at 100; count=200 returns 100
                "maxprice": "free",
                "category1": 998,    # "Games" - excludes DLC/soundtracks/videos/software
                "supportedlang": "english",
                "sort_by": "Released_DESC",
                "infinite": 1,
            },
            throttle_fn=self._throttle_store,
            timeout=20,
        )
        # _get returns the response for 404/410 (steam_client.py:76-77), so an
        # explicit status check is required - same as fetch_store_page:149.
        if not resp or resp.status_code != 200:
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        return body if body.get("success") else None
```

**HTML parsing stays inside `discover_new.py`, not `core/scraper.py`.** `scraper.py` is imported by `fetcher.py`, which drives every data-*writing* script; a bug introduced there breaks `refetch_all.py`, `update_data.py` and `ingest_new.py`. Search-results parsing has no other caller, so keeping the regexes local bounds the blast radius to discovery. (`scraper.py`'s own docstring scopes it to a single app page's HTML.)

### The stop rule

Two modes, both cursor-free — **no `kv_state`, no state file, nothing committed.**

**`--mode daily` (the cron).** Walk from `start=0` upward. Stop when `--stop-after-known-pages` (default **2**) consecutive pages yield zero unknown appids, or at `--max-pages` (default **5**), whichever comes first.

Why 5 pages of insurance when 1 page covers 11 days of releases: 500 rows ≈ **55 days** of release history **[measured]**. A cron that silently stops for a month self-heals on the next successful run with no intervention. The cost of the insurance when nothing is new is 5 search requests, ~8 seconds.

Critically, **"known" for the stop rule must include appids already sitting in `ingest_queue`**, not just those in `data/`. Otherwise yesterday's still-pending candidates count as unknown, the rule never fires, and every daily run walks to `--max-pages`. That is the real reason `GET /api/ingest/known` exists — saving `appdetails` calls is the secondary benefit.

**`--mode backfill` (dispatched by hand).** Walk `--max-pages` pages from `--start-offset`, ignore the stop rule, honour `--budget`. Offsets are stable to within ~9 rows/day **[measured]**, so a human running offsets 1000, 2200, 3400… with one page of overlap loses nothing. This deliberately avoids a persistent cursor for a job that runs about ten times, ever.

**Paging drift.** With `Released_DESC`, a game releasing mid-sweep shifts every row down by one, so the last row of page N can reappear as the first row of page N+1 (and, symmetrically, one row can be skipped). A `session_seen: set[str]` handles the duplicate; the skip is absorbed by tomorrow's 5-page overlap.

---

## 2. Filtering — and where each check lives

Ordered by cost. Everything above the line is free; everything below costs a throttled request.

### Local, zero-cost (from the search HTML)

| Check | Mechanism | Disposition |
|---|---|---|
| Bundle / package | `"," in appid` | drop silently (0 seen on this query **[measured]**, kept as a guard) |
| Malformed id | `not appid.isdigit()` | drop silently |
| Duplicate within sweep | `session_seen` | drop silently |
| Already in the catalogue | `appid in build_index(load_main())` — `data_store.py:237-244`, `:121-132` | drop, count as `known` |
| Recently purged | `dedup_removed(load_jsonl(REMOVED_JSONL))` — `data_store.py:87-104`, `constants.py:11` — keep appids whose `removed_at` is within `--readd-cooldown-days` (default 180) **and** whose `status_code` is permanent (`not_free`, `unavailable`, `not_found_404`, `not_found_410`) | drop, count as `recently_removed`. Older than the cooldown → allowed through, tagged `source="discover:readd"` so the reviewer sees it. Games do go F2P years later; games that went paid last month did not |
| Already queued or already decided | `GET /api/ingest/known` (union of `ingest_queue.appid` any status and `ingest_decisions.appid`) | drop, count as `queued_or_decided` |
| `search_released` contains "coming soon" | text match on the row | **skip this run only.** Never cached, never recorded — verified above that this flips to released within hours |

### Local, one `appdetails` call each

`check_game_health(link, name, client)` (`scripts/core/health_checker.py:47-87`) — the same call `ingest_new.py:65` makes, and it caches the appdetails blob in `HealthResult.data` so nothing is fetched twice (`health_checker.py:80`, `ingest_new.py:90`).

| `HealthResult.status` | Disposition |
|---|---|
| `COMING_SOON` (`:71-72`) | drop, `coming_soon` counter. Not a durable decision |
| `NOT_FREE` (`:74-78`) | drop, `not_free` counter |
| `UNAVAILABLE` / `NOT_FOUND_404` / `NOT_FOUND_410` | drop. **`UNAVAILABLE` is the region-locked case**: `appdetails` returns `success:false` for apps not sold in the runner's region, and `fetch_app_details_full` maps that to `"unavailable"` (`steam_client.py:105-107`). That is a property of the GitHub runner's IP, not of the game — never record it as a decision, never POST it |
| `INVALID_FORMAT` | impossible here (we construct the link), assert and drop |
| `NETWORK_ERROR` | skip, `net` counter, feed the circuit breaker (§3) |
| `OK` | continue to the type check |

**One check `check_game_health` does not do: `type`.** Read `health_checker.py:67-80` — it tests `coming_soon` and `is_free` and returns; it never looks at `data["type"]`. So `discover_new.py` must apply it itself on `health.data`:

```python
if (health.data or {}).get("type") != "game":     # dlc / demo / music / video / series / episode / mod / hardware
    return "wrong_type", None
```

`category1=998` is a *store category* filter, not the appdetails `type`, so this is not redundant. Frequency should be near zero on this query — **[unverified]** whether Steam Playtest apps report `type: "game"`; the belt-and-braces name filter below covers it either way.

Optional name guard (`--strict-names`, default on): drop names matching `r"\b(playtest|demo|soundtrack|OST|server|dedicated server|SDK|benchmark)\b"` case-insensitively. Cheap, and it catches the leak class the `type` field misses.

### Worker-side (defence in depth — the producer is not trusted)

The producer holds a credential that lives in GitHub Actions secrets. The plan's own threat model (`docs/plan/03-admin-d1.md:710`) is right that a poisoned candidate is a phishing vector aimed at one person, so the Worker re-validates every field rather than trusting the sender:

| Check | Action on failure |
|---|---|
| `link` matches `^https://store\.steampowered\.com/app/\d+/$` | reject that candidate, 200 with it listed in `rejected[]` — never 400 the whole batch |
| `appid` equals the appid parsed out of `link` | hard 400: that is a corrupted producer, not a recoverable candidate |
| `app_type === "game"`, `is_free === true`, `health_status === "ok"` | reject the candidate. These are the invariants the reviewer's eye relies on; the Worker must not take the producer's word for them |
| `header_image` host in `{shared.akamai.steamstatic.com, cdn.akamai.steamstatic.com, shared.fastly.steamstatic.com, steamcdn-a.akamaihd.net}` | blank the field, keep the candidate (the live probe returned a `shared.fastly.steamstatic.com` capsule URL, so **fastly must be on the allowlist** — the plan's list omits it) |
| `name` ≤ 200 chars, `payload.short_description` ≤ 2000, `payload_json` ≤ 32 KB | truncate |
| `candidates.length` ≤ 100, body ≤ 1 MB | 413 |
| `appid` present in `ingest_decisions` | skip, count as `suppressed` |
| queue depth ≥ 1000 pending | 507, stop accepting |

The Worker does **not** call Steam. No egress, no second rate-limit surface, no way for a Worker bug to become a Steam ban.

---

## 3. Rate limiting

### Reuse, don't reinvent

Every request — search pages and `appdetails` alike — goes through `SteamClient._throttle_store` (`steam_client.py:47-52`), which enforces `random.uniform(STORE_DELAY_MIN, STORE_DELAY_MAX)` between requests. In CI that is **1.2–2.0 s**, mean ~1.6 s (`constants.py:20`, `:23-24`; `IS_CI` is true because Actions sets `GITHUB_ACTIONS=true`). Because both request types share `self._last_store`, the sweep cannot accidentally double its own rate by interleaving them.

Long runs also adopt the existing batch-pause convention from `purge_unhealthy.py:18-37`: after every `BATCH_SIZE` (50) `appdetails` calls, sleep `random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX)` = 15–30 s (`constants.py:28-30`). Search pages do not count toward the batch counter.

### Wall clock

Mean 1.6 s/request, batch pause ~22 s per 50 `appdetails`:

| Run | Search pages | appdetails | Batch pauses | Total |
|---|---|---|---|---|
| Daily, nothing new | 5 | 0 | 0 | **~8 s** |
| Daily, typical (~9 new) | 2–5 | ~10 | 0 | **~30–45 s** |
| Daily after a week's outage | 5 | ~65 | 1 | **~2.5 min** |
| **First catch-up** (offsets 0–800) | 8 | ~625 | 12 | **~21 min** |
| Historical backfill, `--budget 1200` | ~12 | 1200 | 24 | **~41 min** |
| Full historical tail (~12,500) in one run | 167 | ~12,500 | 250 | **~7.2 h — exceeds the 6-hour GitHub job limit.** Must be chunked |

So: the first catch-up run is a single 21-minute dispatch. The historical tail, if you want it at all, is roughly ten dispatched `--budget 1200` runs, each advancing `--start-offset`.

### On a 429

`_get` already handles it (`steam_client.py:69-73`): read `Retry-After`, sleep it plus `jitter(1,5)`, retry, up to `MAX_RETRIES=3` with a `RETRY_429_WAIT=60` default (`constants.py:32-34`). After three failures `_get` returns `None`, which becomes `("network_error", None)` → `HealthResult(NETWORK_ERROR, ...)` → the loop counts `net` and continues, exactly as `ingest_new.py:67-70` does.

**That existing behaviour has a gap this script must close.** If Steam starts refusing everything, the current pattern turns a 40-minute budget into a 40-minute march of failures — and against a 12,500-call backfill, hours of it. Add a circuit breaker:

```python
if stats.consecutive_net_errors >= MAX_CONSECUTIVE_NET_ERRORS:   # 10
    print("Aborting sweep: 10 consecutive network errors - Steam is refusing us.")
    stats.aborted = True
    break            # flush whatever was already collected, exit 1
```

A single success resets the counter. Nothing is lost by aborting: unsent appids are still unknown tomorrow, and the sweep restarts from `start=0`.

---

## 4. The POST contract

### Placement and auth

```
POST https://free-steam-games.win/api/ingest/candidates
GET  https://free-steam-games.win/api/ingest/known
```

A **separate Access application** (`f2p-ingest`, path `/api/ingest`) with a **Service Auth** policy naming only the `discover-new` service token. Not a policy added to the existing `/api/admin` app. The reason is the whole security story: the discovery credential must be able to *propose* and structurally incapable of *approving*.

Three configuration consequences, all in files I read:

1. **`web/wrangler.jsonc:88`** — append the new app's AUD tag to `ACCESS_AUD`. The comment on the line above literally says to do this for every new Access application, and `access.ts:118-127` splits on commas.
2. **`web/worker/index.ts`** — `/api/ingest/*` currently falls through to `jsonError(404)` at `:72-74`. It needs its own branch beside the admin branch at `:34-70`, calling the same `verifyAccessJwt` before any dispatch. `wrangler.jsonc:50` already routes `/api/*` to the Worker, so no asset config changes.
3. **Two one-line identity guards.** `AccessIdentity.isServiceToken` (`access.ts:24`, `:139-140`) is currently only *reported* by `/api/admin/me` (`admin.ts:51`) and never enforced anywhere. Enforce it now:
   - `/api/ingest/*`: `if (!who.isServiceToken) return jsonError(404, "not found")`
   - future `/api/admin/queue/:id/approve|reject`: `if (who.isServiceToken) return jsonError(403, "human review required")`

   Those two lines make credential-crossing impossible even if an Access policy is later misconfigured — the same argument `index.ts:29-33` already makes for verifying the JWT at all.

### Request

```http
POST /api/ingest/candidates HTTP/1.1
Host: free-steam-games.win
Content-Type: application/json; charset=utf-8
Accept: application/json
CF-Access-Client-Id: <id>.access
CF-Access-Client-Secret: <secret>
Idempotency-Key: gh-<run_id>-<run_attempt>-<chunk_index>
User-Agent: SteamF2PTracker-discover/1.0 (+github-actions)
```

```json
{
  "source": "discover",
  "generated_at": "2026-09-11T22:41:03Z",
  "producer": {
    "workflow": "discover-new.yml",
    "run_id": "18234771902",
    "run_attempt": "1",
    "run_url": "https://github.com/poli0981/free-steam-games-list/actions/runs/18234771902",
    "mode": "daily"
  },
  "sweep": { "start_offset": 0, "pages_walked": 3, "total_count": 16668, "appdetails_spent": 27 },
  "candidates": [
    {
      "link": "https://store.steampowered.com/app/3975470/",
      "appid": "3975470",
      "name": "A Night at Moka Efti: A Babylon Berlin Story",
      "header_image": "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3975470/header.jpg",
      "release_date": "Sep 10, 2026",
      "app_type": "game",
      "is_free": true,
      "health_status": "ok",
      "payload": {
        "short_description": "...",
        "genres": ["Adventure", "Free To Play"],
        "platforms": ["windows", "mac"],
        "developers": ["..."],
        "publishers": ["..."],
        "categories": ["Single-player"],
        "search_released_text": "10 Sep, 2026",
        "search_offset": 0
      }
    }
  ]
}
```

Field names map 1:1 onto `ingest_queue` columns (`web/worker/migrations/0001_init.sql:11-44`); `payload` becomes `payload_json`. `reviews_raw` / `current_players_raw` are deliberately absent — the script does **not** call `fetch_reviews` or `fetch_player_count`, which would double or triple the per-candidate cost for data a release-day game does not have yet. The columns keep their `'N/A'` defaults (`:26-29`), and `ingest_new.py` fills the real values after approval via `fetch_full` (`ingest_new.py:90`). A `--with-reviews` flag exists for the daily run if triage value proves worth +1.6 s/candidate.

**`status`, `decided_by`, `decided_at`, `first_seen_at`, `seen_count` are not accepted from the client.** The `status` CHECK constraint (`0001_init.sql:34-35`) permits `'approved'`; a Worker that spread client JSON into the INSERT would let a compromised producer enqueue a pre-approved row. The INSERT names its columns and binds the literal:

```sql
INSERT INTO ingest_queue (id, appid, link, name, header_image, release_date,
                          app_type, is_free, health_status, payload_json,
                          source, status, first_seen_at, last_seen_at, seen_count)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'game', 1, 'ok', ?7, 'discover', 'pending', ?8, ?8, 1)
ON CONFLICT(appid) WHERE status IN ('pending','deferred','approved')
DO UPDATE SET last_seen_at = excluded.last_seen_at,
              seen_count   = ingest_queue.seen_count + 1;
```

**[unverified — test before relying on it]** that D1's SQLite accepts a partial-index conflict target (`ON CONFLICT(appid) WHERE ...`) matching `uq_queue_open_appid` (`0001_init.sql:47-49`). If it does not, catch the constraint violation and issue the UPDATE — do not drop to a SELECT-then-INSERT race.

### Batching and idempotency

`--post-chunk` = 50 candidates per POST, **flushed incrementally during the sweep**, not accumulated to the end. A 40-minute backfill that dies at minute 38 must not throw away 38 minutes of spent `appdetails` calls.

**Idempotency rests on `uq_queue_open_appid`, not on the header.** There is no `ingest_batches` table in migration 0001, so `Idempotency-Key` is sent (cheap, forward-compatible, logged into `audit_log.detail_json`) but **not honoured**. Say that out loud so nobody assumes replay-safety: a replayed batch inserts nothing new, it bumps `last_seen_at` and `seen_count` — which is itself the useful signal the schema comment at `:43` anticipates ("still showing up on day 5, still not reviewed"). True replay semantics need a migration 0002.

**I recommend against the plan's HMAC-over-body (`docs/plan/03-admin-d1.md:377`) for v1.** The HMAC secret and the Access service token would live in the same GitHub Actions secret store, so the compromise that leaks one leaks both. It defends only against a compromised Cloudflare Access or a TLS-terminating middlebox, and it costs a shared secret that must be rotated in two places. The server-side field revalidation in §2 is what actually bounds a poisoned candidate.

### `GET /api/ingest/known`

```json
200 {"appids": ["3975470", "4535760"], "count": 3456, "generated_at": "2026-09-11T22:40:12Z"}
```

Union of `SELECT appid FROM ingest_queue` (any status) and `SELECT appid FROM ingest_decisions`. Even after a full backfill that is ~13k short strings, ~130 KB. `Cache-Control: no-store`. Failure here is never fatal — see below.

### Client behaviour by response

| Status | Script does |
|---|---|
| 200 | log `inserted/duplicates/suppressed/rejected/queue_depth`, continue |
| 401 / 403 | **abort immediately, exit 2.** The service token is wrong, revoked, or expired (Cloudflare service tokens default to a 1-year life). Retrying a bad credential only burns Access rate limits. Access denies with an **HTML** body, so the script must not assume JSON — parse defensively and print `resp.text[:200]` |
| 400 | producer bug. Log the batch index and the `detail` field, drop that chunk, continue with the rest, exit 1 at the end so CI goes red |
| 409 | treat as success, note it |
| 413 | halve the chunk and retry once; if it still 413s, drop to 25 and retry once more; then fail that chunk |
| 429 | honour `Retry-After` (cap 300 s), up to 3 attempts, then stop POSTing and exit 1 |
| 507 `queue_full` | **stop cleanly, exit 0 with a warning.** This is backpressure working as designed — the admin has not reviewed. Re-running tomorrow is the correct behaviour, and a red CI badge for an unreviewed queue trains people to ignore the badge |
| 5xx / connection error / timeout | exponential backoff 2 s, 8 s, 32 s (+jitter), 3 attempts; then leave the remainder unsent and exit 1. Nothing is permanently lost — those appids are still unknown tomorrow |

`GET /api/ingest/known` failing (any status) is **never fatal**: log a warning, proceed with the local exclusion sets only. The run costs more `appdetails` calls and may walk to `--max-pages`, and the server-side unique index still prevents duplicate rows.

Exit codes: **0** clean, **1** partial (some batches failed / sweep aborted by the breaker), **2** fatal configuration or auth.

---

## 5. Script structure

```python
#!/usr/bin/env python3
"""Discover newly released F2P games and propose them for review.

READ-ONLY with respect to the repository. This script never writes data/,
never commits, and cannot add a game to the catalogue. It proposes candidates
to the admin queue; a human approves; scripts/ingest_new.py does the writing.

Deliberately NOT imported: save_main, save_jsonl, clear_temp, make_skeleton,
merge_extension_data, fetch_full. If you find yourself needing one of them
here, you are writing the wrong script.
"""
from __future__ import annotations

import argparse, json, os, random, re, sys, time
from dataclasses import dataclass, field
from typing import Iterator, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # matches ingest_new.py:9

import requests                                                  # requirements.txt (pinned 2.34.2)

from core.constants import (BATCH_SIZE, BATCH_PAUSE_MIN, BATCH_PAUSE_MAX, REMOVED_JSONL)
from core.data_store import (load_main, load_jsonl, build_index, dedup_removed, now_iso)
from core.steam_client import get_client, SteamClient
from core.health_checker import check_game_health, NETWORK_ERROR, OK
```

### Module constants

```python
PAGE_SIZE       = 100          # verified server cap: count=200 returns 100
DEFAULT_ENDPOINT       = "https://free-steam-games.win/api/ingest/candidates"
DEFAULT_KNOWN_ENDPOINT = "https://free-steam-games.win/api/ingest/known"
MAX_CONSECUTIVE_NET_ERRORS = 10
PERMANENT_REMOVAL_CODES = frozenset({"not_free", "unavailable", "not_found_404", "not_found_410"})

_RE_ROW      = re.compile(r'data-ds-appid="([^"]+)"(.*?)(?=data-ds-appid=|$)', re.S)
_RE_TITLE    = re.compile(r'class="title">([^<]*)<')
_RE_RELEASED = re.compile(r'class="search_released[^"]*">\s*(.*?)\s*</div>', re.S)
_RE_STRIP    = re.compile(r"<[^>]+>")
_RE_JUNK_NAME = re.compile(r"\b(playtest|demo|soundtrack|ost|dedicated server|sdk|benchmark)\b", re.I)
```

### Types

```python
@dataclass(slots=True)
class SearchRow:
    appid: str
    name: str
    released_text: str
    offset: int

@dataclass(slots=True)
class Candidate:
    link: str
    appid: str
    name: str
    header_image: str
    release_date: str
    app_type: str
    is_free: bool
    health_status: str
    payload: dict
    def to_json(self) -> dict: ...

@dataclass(slots=True)
class Stats:
    pages: int = 0;            rows: int = 0
    known: int = 0;            queued_or_decided: int = 0
    recently_removed: int = 0; bundles: int = 0
    coming_soon_prefilter: int = 0
    appdetails: int = 0
    ok: int = 0;               coming_soon: int = 0
    not_free: int = 0;         unavailable: int = 0
    wrong_type: int = 0;       junk_name: int = 0
    net: int = 0;              consecutive_net: int = 0
    posted: int = 0;           inserted: int = 0
    duplicates: int = 0;       suppressed: int = 0
    post_failures: int = 0
    budget_exhausted: bool = False
    aborted: bool = False
```

### Functions

| Signature | Role |
|---|---|
| `parse_args(argv: list[str] \| None = None) -> argparse.Namespace` | CLI, table below |
| `parse_search_rows(html: str, base_offset: int) -> list[SearchRow]` | `_RE_ROW` over `results_html`; `_RE_STRIP` the title; strip the released text |
| `iter_pages(client, start_offset, max_pages) -> Iterator[tuple[int, list[SearchRow], int]]` | yields `(page_index, rows, total_count)`; stops on `None` from `fetch_search_page` or on an empty page (verified: past-end returns 0 rows) |
| `local_known_appids() -> set[str]` | `set(build_index(load_main()))` |
| `recent_removals(cooldown_days: int) -> set[str]` | `dedup_removed(load_jsonl(REMOVED_JSONL))`, filtered by `status_code in PERMANENT_REMOVAL_CODES` and `removed_at` within the cooldown |
| `fetch_remote_known(url, headers, timeout=15) -> tuple[set[str], bool]` | never raises; returns `(set(), False)` on any failure |
| `classify(row, client, strict_names) -> tuple[str, Optional[Candidate]]` | the one `appdetails` call; returns one of `ok / coming_soon / not_free / unavailable / not_found / wrong_type / junk_name / network_error` |
| `build_candidate(row, health) -> Candidate` | reads `health.data` only — no second fetch (`health_checker.py:80`) |
| `post_batch(session, endpoint, headers, batch, meta, chunk_index) -> tuple[str, dict]` | returns `("ok"\|"retry"\|"fatal"\|"queue_full", body)`; owns the status table in §4 |
| `chunked(seq, n) -> Iterator[list]` | |
| `render_summary(stats, args) -> str` | one-screen report |
| `write_step_summary(text: str) -> None` | appends to `$GITHUB_STEP_SUMMARY` if set; no-op locally |
| `main(argv=None) -> int` | |

### CLI

| Flag | Daily default | Backfill default | Meaning |
|---|---|---|---|
| `--mode` | `daily` | `backfill` | selects the stop rule |
| `--start-offset` | 0 | 0 | search offset |
| `--max-pages` | 5 | 20 | pages to walk |
| `--stop-after-known-pages` | 2 | n/a | consecutive all-known pages that end a daily run |
| `--budget` | 200 | 1200 | max `appdetails` calls (the only real cost) |
| `--post-chunk` | 50 | 50 | candidates per POST |
| `--endpoint` / `--known-endpoint` | live URLs | | override for staging |
| `--readd-cooldown-days` | 180 | | purge cooldown |
| `--with-reviews` | off | off | +1 store call per candidate |
| `--strict-names` | on | on | `_RE_JUNK_NAME` guard |
| `--dry-run` | off | off | no POST; write the batch to `$RUNNER_TEMP` or stdout |
| `--json-out PATH` | none | none | debug dump. Rejects any path under `data/` or `scripts/temp_info.jsonl` — argparse-level assertion, not a convention |

### `main()` control flow

```
args = parse_args()
if not args.dry_run and not (CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET):
    print("Missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET"); return 2

known  = local_known_appids()                       # ~3.4k, instant
known |= recent_removals(args.readd_cooldown_days)
remote, remote_ok = fetch_remote_known(...)         # never fatal
known |= remote
if not remote_ok: warn("proceeding without the remote exclusion set")

client  = get_client()                              # steam_client.py:177-181
session = requests.Session()                        # for the POST only, not Steam
pending, session_seen, stats = [], set(), Stats()
clean_pages = 0

for page_index, rows, total in iter_pages(client, args.start_offset, args.max_pages):
    stats.pages += 1; stats.rows += len(rows)
    fresh = [r for r in rows
             if "," not in r.appid and r.appid.isdigit()
             and r.appid not in known and r.appid not in session_seen]
    session_seen.update(r.appid for r in fresh)
    # (counters for bundles / known / queued_or_decided attributed here)

    if not fresh:
        clean_pages += 1
        if args.mode == "daily" and clean_pages >= args.stop_after_known_pages:
            break
        continue
    clean_pages = 0

    for row in fresh:
        if stats.appdetails >= args.budget:
            stats.budget_exhausted = True; break
        if "coming soon" in row.released_text.lower():
            stats.coming_soon_prefilter += 1; continue

        status, cand = classify(row, client, args.strict_names)
        stats.appdetails += 1
        if status == "network_error":
            stats.net += 1; stats.consecutive_net += 1
            if stats.consecutive_net >= MAX_CONSECUTIVE_NET_ERRORS:
                stats.aborted = True; break
            continue
        stats.consecutive_net = 0
        if cand is None: continue
        pending.append(cand)

        if len(pending) >= args.post_chunk:
            flush(pending)                          # incremental: never lose spent calls
        if stats.appdetails % BATCH_SIZE == 0:      # purge_unhealthy.py:36-37 convention
            time.sleep(random.uniform(BATCH_PAUSE_MIN, BATCH_PAUSE_MAX))

    if stats.aborted or stats.budget_exhausted: break

flush(pending)                                       # final partial chunk
print(render_summary(stats, args)); write_step_summary(...)
return 0 if clean else (1 if partial else 2)
```

`flush()` closes over `post_batch`, updates `stats`, and on a `fatal` result raises a `SystemExit(2)`; on `queue_full` it sets a flag that ends the sweep with exit 0.

### Error handling notes

- **Steam access never raises.** `_get` catches everything and returns `None` (`steam_client.py:82-88`), so the script's own `try/except` is confined to JSON parsing of the search payload and to the `requests` POST path.
- **`_RE_ROW` returning 0 rows on a 200 response** means Steam changed the markup. That is a silent-failure class the daily counters must catch: if `stats.rows == 0` while `total_count > 0`, exit 1 with `"search markup changed - parser needs updating"`. Without this the workflow goes green forever while discovering nothing.
- **Expected volume as an alarm.** ~8–9/day **[measured]**. Three consecutive days of zero candidates is far more likely a broken producer than a quiet Steam. `audit_log` gives this for free — the ingest route writes one row per accepted batch, so `SELECT MAX(created_at) FROM audit_log WHERE action='ingest.candidates'` is the staleness signal, with no `kv_state` table and no migration (the plan's `kv_state.last_discovery_at` at `docs/plan/03-admin-d1.md:360` does not exist in migration 0001).

### Optional, explicitly not load-bearing

A negative memo (appids that spent an `appdetails` call and failed for a durable reason: `not_free`, `wrong_type`, repeated `unavailable`) cached via `actions/cache` at `$RUNNER_TEMP/discover-negatives.json`, TTL 90 days for `not_free`/`wrong_type`, never for `coming_soon`. It matters mainly for region-locked `unavailable` responses, which recur every run from a US runner. A cache miss must only make the run slower, never wrong — and it must never be written into the repo.

---

## 6. The workflow

`.github/workflows/discover-new.yml`:

```yaml
name: Discover New F2P Games

# Proposes candidates to the admin queue. Writes NOTHING to the repository:
# no data/, no commit, no push. `permissions: contents: read` is what makes
# that structural rather than a promise.
on:
  schedule:
    # 22:25 UTC. The only quiet slot: update-json runs 00:00 (a ~2h Steam
    # refetch), top-online 03:00, dead-links 04:00, mark-dead 04:30,
    # purge 05:00, reviews/anti-cheat 06:00. snapshot-daily at 23:00 touches
    # no network. Nothing else is talking to Steam at 22:25.
    - cron: '25 22 * * *'
  workflow_dispatch:
    inputs:
      mode:
        description: 'daily | backfill'
        default: 'daily'
      start_offset:
        description: 'Search offset (backfill only)'
        default: '0'
      max_pages:
        description: 'Pages to walk (blank = mode default)'
        default: ''
      budget:
        description: 'Max appdetails calls (blank = mode default)'
        default: ''
      dry_run:
        description: 'Run the sweep, POST nothing'
        type: boolean
        default: false

# READ. This workflow cannot push even if someone adds a git command to it.
permissions:
  contents: read

# NOT the data-write group. That group exists to serialise pushes to data/
# (CLAUDE.md:58, ingest-new.yml:9-11); this job pushes nothing, and joining it
# would queue discovery behind the ~2h refetch for no benefit — occasionally
# past its own next cron. Its own group still prevents two sweeps hammering
# Steam at once, and cancel-in-progress stays false so a queued dispatch does
# not throw away appdetails calls already spent.
concurrency:
  group: discover-new
  cancel-in-progress: false

jobs:
  discover:
    # Forks have no service token; a scheduled run there would fail nightly.
    if: github.repository == 'poli0981/free-steam-games-list'
    runs-on: ubuntu-latest
    # Bounds a hung run. A daily sweep is under a minute; the largest sane
    # backfill dispatch (--budget 1200) is ~41 minutes.
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-python@v6
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: requirements.txt

      # discover_new.py uses requests for the POST; core/* needs it too.
      - run: pip install --quiet -r requirements.txt

      # Structural guard, not a style check: this script must never gain the
      # ability to write repo data or shell out to git.
      - name: Assert discovery cannot write repo data
        run: |
          if grep -nE '\b(save_main|save_jsonl|clear_temp|make_skeleton|fetch_full|subprocess|os\.system)\b|git ' scripts/discover_new.py; then
            echo "::error file=scripts/discover_new.py::discover_new.py must not write repo data or shell out"
            exit 1
          fi

      - name: Discover
        env:
          # Secrets reach the process through env only. Never interpolate them
          # into a shell command line - bot-ingest.yml does that at its final
          # step and it is exactly how a token ends up in a public log.
          CF_ACCESS_CLIENT_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}
          CF_ACCESS_CLIENT_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
          MODE: ${{ inputs.mode || 'daily' }}
          START_OFFSET: ${{ inputs.start_offset || '0' }}
          MAX_PAGES: ${{ inputs.max_pages }}
          BUDGET: ${{ inputs.budget }}
          DRY_RUN: ${{ inputs.dry_run }}
        run: |
          set -euo pipefail
          args=(--mode "$MODE" --start-offset "$START_OFFSET")
          [ -n "$MAX_PAGES" ] && args+=(--max-pages "$MAX_PAGES")
          [ -n "$BUDGET" ]    && args+=(--budget "$BUDGET")
          [ "$DRY_RUN" = "true" ] && args+=(--dry-run)
          python scripts/discover_new.py "${args[@]}"

      # If this ever fires, the script wrote something it must not write.
      - name: Assert the working tree is clean
        if: always()
        run: |
          if [ -n "$(git status --porcelain)" ]; then
            echo "::error::discover_new.py modified the working tree"
            git status --porcelain
            exit 1
          fi
```

**Why there is no `bash/discover.sh`.** Every script in `bash/` ends in `git add … && git commit && git push` (`bash/ingest.sh:6-8`, `bash/snapshot.sh:5-7` — all nine follow the pattern). A new wrapper would be written by copying one of them, and the commit tail would come along. Calling Python directly from the workflow — the way `mark-dead-games.yml:38-48` does — means there is no file whose shape invites a push.

**Secrets needed: `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. That is all.** Not `STEAM_API_KEY`: the only method requiring a key is `fetch_player_count` (`steam_client.py:129-140`), and discovery never calls it. Not `GH_TOKEN`: nothing is pushed. Note for the ops runbook — Cloudflare service tokens default to a **1-year** expiry, which is precisely the silent-expiry failure mode that already cost this project a month (`docs/ADMIN.md:19`); put the renewal date in the credential canary described at `docs/plan/05-ci-automation.md:928`.

### First catch-up, operationally

```
workflow_dispatch: mode=backfill, start_offset=0, max_pages=9, budget=700
```
~21 minutes, ~625 candidates into `ingest_queue`. Review in batches; the queue-depth 507 backpressure exists for exactly this. Then the cron takes over at ~9/day. The historical tail, if wanted at all, is a later decision: ~10 dispatches at `--budget 1200`, `--start-offset` stepping 1000 → 2200 → 3400 …, and worth weighing against the fact that `mark_dead_games.py` will flag much of a 2013–2019 F2P cohort within two weeks of ingesting it.

---

## 7. What it must not do, and what stops it

| Prohibition | Enforcement — four independent layers |
|---|---|
| Must not write `data/` | (1) The script never imports `save_main` / `save_jsonl` / `clear_temp`, and the module docstring says why. (2) The pre-run `grep` guard fails the job if those names appear. (3) `--json-out` rejects any path under `data/` or equal to `scripts/temp_info.jsonl` at argparse level. (4) The post-run `git status --porcelain` guard fails the job if the tree is dirty at all |
| Must not commit or push | `permissions: contents: read` — the `GITHUB_TOKEN` handed to this job is physically incapable of writing the repo. No `bash/` wrapper exists to carry a commit tail. No `git` invocation anywhere in the workflow except the read-only status check |
| Must not add a game without human approval | Three gates. **(a)** The Worker binds `status` as the literal `'pending'` in a column-named INSERT; the producer cannot supply a status. **(b)** The service token's Access policy covers `/api/ingest` only, and the Worker additionally rejects `who.isServiceToken` on any approve/reject route — so the discovery credential can propose and never decide. **(c)** Even after a human approves, the queue row is not the record: approval writes a link into `scripts/temp_info.jsonl`, the push triggers `ingest-new.yml`, and `ingest_new.py:65` re-runs `check_game_health` and re-fetches everything from Steam (`:90`). A candidate that went paid between discovery and approval is rejected there and logged to `removed_games.jsonl` (`:73-77`). D1 never becomes a source of game data |
| Must not touch `MANUAL_FIELDS` | It never constructs a game record at all — no `make_skeleton`, no `merge_extension_data`. `payload_json` is inert review context; `ingest_new.py` builds the real record and re-applies manual overrides (`:85-95`, CLAUDE.md:24-29) |

---

## 8. Open items I could not verify

1. **Partial-index `ON CONFLICT` in D1** (`ON CONFLICT(appid) WHERE status IN (...)`). Load-bearing for idempotency. Test with a deliberate duplicate insert before relying on it; the plan flags the same at `docs/plan/03-admin-d1.md` (its "Flag — verify" note (b)).
2. **Service-token JWT claim shape.** `access.ts:136-140` reads `common_name`, and the parent reports `/api/admin/health` working end to end with a human identity — but I did not see a service-token round trip. Verify `/api/ingest/me`-equivalent returns `isServiceToken: true` before wiring the guards that depend on it.
3. **Whether one Cloudflare Access application can carry two paths**, or whether `/api/ingest` genuinely needs a third application and a third AUD tag in `ACCESS_AUD`. The design assumes a third application (safer, and it is what keeps the service-token policy off `/api/admin/*`).
4. **Playtest apps' `type` value.** `--strict-names` covers the case either way, but the frequency is unmeasured.
5. **Region-locked `unavailable` rate from a GitHub runner IP.** This determines whether the optional negative cache is worth building. The first backfill run's counters measure it — that is why `Stats` breaks the drop reasons out individually rather than reporting one "skipped" number.
6. **`supportedlang=english`.** Keeping it excludes 1,537 titles (8.4%) **[measured]**. Matching the existing dataset's character is the v1 default; it is a one-line knob if you later decide the tracker should be language-neutral.

### Files this design touches

- new: `E:\2\scripts\discover_new.py`
- new: `E:\2\.github\workflows\discover-new.yml`
- edit (additive, one new method): `E:\2\scripts\core\steam_client.py` — insert `fetch_search_page` after `fetch_store_page` (`:142-151`)
- edit: `E:\2\web\worker\index.ts` — new `/api/ingest/*` branch beside the admin branch (`:34-70`)
- edit: `E:\2\web\wrangler.jsonc:88` — append the `f2p-ingest` AUD tag
- edit: `E:\2\CLAUDE.md:52-57` — the "there is no automatic discovery" paragraph stops being true the day this lands
- new (Worker side, not my assignment): `web/worker/routes/ingest.ts`, plus lifting `audit()` out of `routes/admin.ts:26-39` into a shared `lib/audit.ts`