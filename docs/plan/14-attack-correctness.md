## Verdict

Both designs are unusually well-grounded — the great majority of their file/line citations check out, and I re-ran the two things they each flagged as unverified and they both pass. But each contains at least one claim that is wrong about this repo, and together they miss the four operational failures that actually break the loop. The most serious problem is shared: **nothing anywhere marks a queue row as "the game is actually published," and there are four writers to `scripts/temp_info.jsonl`, one of which truncates the file.**

---

## 1. Things I verified as CORRECT (do not re-litigate)

**Executed, not read.** I loaded `E:\2\web\worker\migrations\0001_init.sql` into SQLite 3.50.4 and ran both designs' statements:

- Design 1's upsert (`ON CONFLICT(appid) WHERE status IN ('pending','deferred','approved') DO UPDATE SET seen_count = ingest_queue.seen_count + 1`) — **works**, correctly bumps `seen_count`/`last_seen_at`.
- Design 2's `... DO NOTHING` — **works**, dedupes to one row; after flipping the row to `committed` a second `pending` row for the same appid inserts cleanly (history accumulates as intended).
- Both column lists balance, and no NOT-NULL-without-default column (`id`, `appid`, `link`, `first_seen_at`, `last_seen_at`) is omitted. No CHECK is violated (`is_free IN (0,1)` gets a literal `1`; `decision IN ('approved','rejected')` is respected everywhere; `status` values all fall inside `0001_init.sql:34-35`; `commit_jobs.status` inside `:73-74`).
- STRICT (`:44`) does make `id TEXT PRIMARY KEY` reject NULL — the usual rowid-table quirk does not apply here.

**So Design 1 open item #1 and Design 2 flags #2 are closed: partial-index `ON CONFLICT` is standard SQLite and works.** Design 2's `json_each` claim also works (see §3.1 for the trap).

**Design 1's Python API usage is accurate.** Every function it imports exists with that signature: `load_main`/`load_jsonl`/`build_index`/`dedup_removed`/`now_iso` (`scripts/core/data_store.py:121,61,237,87,190`), `check_game_health(link, name, client)` (`scripts/core/health_checker.py:47-48`), `get_client()` (`scripts/core/steam_client.py:177-181`), `BATCH_SIZE`/`BATCH_PAUSE_*`/`REMOVED_JSONL` (`scripts/core/constants.py:28-30,11`). The `_get(url, params=, throttle_fn=, timeout=)` call matches `steam_client.py:61`, and the explicit `status_code != 200` check is genuinely required because `_get` returns the response for 404/410 (`:76-77`).

**Design 1's single best finding is correct and load-bearing:** `check_game_health` never inspects `data["type"]` — `health_checker.py:67-80` tests `coming_soon` then `is_free` and returns. A `type` check must be added by the caller. Likewise `HealthResult.data` is populated only on OK (`:80`), so the "no double fetch" claim holds.

**Design 1's live-endpoint measurements reproduce.** I re-ran the search endpoint: `count=50 → 50` rows, `count=100 → 100`, `count=200 → 100` (cap confirmed), `total_count=16668`. Its three regexes match today's markup — the real attribute is `class="search_released responsive_secondrow"` and the `[^"]*` tail covers the extra classes. Appid `5033550` did render `Coming soon` in `search_released`, exactly as described.

**Design 2's recovery and diff of `git-data.ts` is accurate on every point I checked** (`git show 7729a191:web/src/lib/git-data.ts`):

- `:107` hardcodes `?ref=${DEFAULT_BRANCH}` — read and parent can diverge. Correct.
- `:118` `data.encoding === "base64" && data.content` is falsy for an empty file. `git ls-files -s scripts/temp_info.jsonl` → blob `e69de29…` (the empty blob), 0 bytes. So the extra `/git/blobs` hop is real, today, on the one file this design writes.
- `commitFileWithRetry` (`:402-410`) → `commitFile` → `commitFiles` → `getHead` (`:334`): the **parent** is refreshed, the **content** is not. Design 2's "retry must rebuild the content, not just the parent" is the correct fix, and the failure it describes (resurrecting a consumed line / dropping another writer's line) is exactly what would happen.
- `updateBranchRef` (`:287-304`) hardwires `force: false` and maps 422 → `RefAdvancedError` at `:301`. Keeping it is right.
- 7 subrequests per attempt is the correct count for `getHead`(2) + contents + blob + tree + commit + PATCH ref.

**Design 2's CSRF finding is real and Design 1 misses it entirely.** `web/worker/lib/access.ts:79-84` accepts the JWT from the `CF_Authorization` cookie; `routes/admin.ts:121-124` (`ping`) is the only POST today and is harmless. A cross-origin HTML form POST — no preflight, no body needed — to `/api/admin/queue/<id>/approve` would carry the cookie and Access would proxy it with `Cf-Access-Jwt-Assertion` injected. `SITE_ORIGIN` is already bound at `web/wrangler.jsonc:72`.

**Design 2's other verified points:** `/api/ingest/*` does fall to `jsonError(404)` at `index.ts:72-74`; `wrangler.jsonc:50` already routes `/api/*`; `worker-configuration.d.ts:10` really is stale (one AUD vs two at `wrangler.jsonc:88`); `wrangler.jsonc` has **no** `triggers.crons` block and `index.ts:16-17` exports only `fetch`; D1 rejects JS booleans/`undefined` bindings, so `is_free ? 1 : 0` is required; `routes/data.ts:20-24` allowlists exactly `index.json` + shards + `removed_games.jsonl`.

---

## 2. Design 1 — where it is wrong

**2.1 The workflow's own guard makes the job red on every run, forever.** This is fatal on day one.

§6 specifies:
```
grep -nE '\b(save_main|save_jsonl|clear_temp|make_skeleton|fetch_full|subprocess|os\.system)\b|git ' scripts/discover_new.py  →  exit 1
```
§5 specifies the module docstring:
```
Deliberately NOT imported: save_main, save_jsonl, clear_temp, make_skeleton,
merge_extension_data, fetch_full. ...
```
The guard greps the file, not the imports. The docstring matches it. `grep` exits 0, the `if` fires, `exit 1`. The two sections of the same design contradict each other. Either anchor the pattern to import statements (`^\s*from core\.data_store import .*save_main`) or drop the docstring list.

**2.2 `unavailable` is treated as permanent and as an IP artifact, in the same design.** §2 puts `unavailable` in `PERMANENT_REMOVAL_CODES` and suppresses those appids for 180 days; §2's own table then says `UNAVAILABLE` "is a property of the GitHub runner's IP, not of the game — never record it as a decision." Both cannot hold. This is not theoretical: the live `scripts/removed_games.jsonl` is `Counter({'not_free': 56, 'unavailable': 27, None: 2})` — 32% of the file. The cooldown will suppress a third of re-add candidates on a region-lock artifact.

**2.3 Search-row names are HTML-escaped and never unescaped.** `parse_search_rows` runs `_RE_TITLE` then `_RE_STRIP` (tags only). Against the live page, appid `5010700` parses as `Flip &amp; Shop Simulator: Prologue`; `5097840` as `Spellbound &amp; Shelved`. Whatever consumes `SearchRow.name` — at minimum `_RE_JUNK_NAME`, and `Candidate.name` if it doesn't strictly use `health.data["name"]` — receives escaped text that flows into `ingest_queue.name` and the reviewer's screen. Needs `html.unescape()`. Related: those same two rows are `Prologue` titles, which are `type: "game"`, `is_free: true`, and demos in all but name — the `type` check does not catch them and `_RE_JUNK_NAME` does not list `prologue`.

**2.4 Truncating `payload_json` at 32 KB produces invalid JSON.** §2's Worker-side table says "`payload_json` ≤ 32 KB | truncate". `ingest_queue.payload_json` is `TEXT NOT NULL DEFAULT '{}'` (`0001_init.sql:31`); truncating a serialized object mid-string makes every later `json_extract()` and every client `JSON.parse` fail. Drop fields or reject the candidate; never truncate the serialization. (Truncating `name`/`short_description` as *fields* is fine.)

**2.5 A fabricated citation.** §4 attributes "still showing up on day 5, still not reviewed" to "the schema comment at `:43`". `0001_init.sql:43` is `seen_count INTEGER NOT NULL DEFAULT 1` with no comment. The quote is from `docs/plan/03-admin-d1.md:421`.

**2.6 A false claim about this repo's CI.** §6 says secrets must not be interpolated into a shell command line "— `bot-ingest.yml` does that at its final step and it is exactly how a token ends up in a public log." It does not. `.github/workflows/bot-ingest.yml:163-168` is `if: failure()` with `env: BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}`, read at `:185` via `os.environ['BOT_TOKEN']`. Design 1 is repeating an error from `docs/plan/03-admin-d1.md:710` (which also says `if: always()`; it is `if: failure()`). The advice is right, the evidence is fabricated — and the same paragraph is cited as justification elsewhere.

**2.7 The `source="discover:readd"` tag has nowhere to go.** §2 says older-than-cooldown removals are "allowed through, tagged `source='discover:readd'` so the reviewer sees it." §4's INSERT binds `source` as the literal `'discover'` and explicitly refuses client-supplied `status`/`source`. The reviewer will never see the tag.

**2.8 The 429 claim holds only for integer `Retry-After`.** `steam_client.py:71` is `int(resp.headers.get("Retry-After", RETRY_429_WAIT))`. An HTTP-date `Retry-After` raises `ValueError`, which is caught by `except Exception: return None` (`:86-87`) — immediate `network_error`, zero retries. Design 1 asserts "read `Retry-After`, sleep it plus jitter, retry, up to `MAX_RETRIES=3`" as established behaviour.

**2.9 The negative memo is load-bearing, not optional.** §5 calls it "explicitly not load-bearing." For `--mode daily` that's true. For the 12,500-call historical backfill it is not: nothing durable records a `not_free`/`wrong_type`/`unavailable` outcome — the appid is not in `data/`, not in `ingest_decisions`, not in `removed_games.jsonl` — so every re-run of an offset re-spends every rejected `appdetails` call. The counters go to `$GITHUB_STEP_SUMMARY`, which expires. Design 1 half-catches this at open item #5.

**2.10 Minor.** "all nine follow the pattern" — `bash/` has 11 scripts, all matching. `:69-73` for the 429 path is `:70-73`. `:74-78` for NOT_FREE is `:73-78`.

---

## 3. Design 2 — where it is wrong

**3.1 `json_each` fails silently on the one typing slip that matters.** I tested it against the real schema:
```
json_each('["111"]')  →  matches appid '111'
json_each('[111]')    →  matches nothing
```
If the appid array is ever built from numbers, the SELECT returns empty, everything looks new, and every write proceeds. For open rows that is harmless — `uq_queue_open_appid` catches it. For **decided** rows there is no backstop at all: `ingest_decisions` has no constraint on `ingest_queue`, so every previously-rejected appid silently re-enters the review queue with no error anywhere. Design 2 claims the partial index is "strictly stronger than a batch key"; it is strictly stronger for open rows and provides *zero* protection for decided ones. Build the array with `String(...)` and assert on it.

**3.2 §2.4 lets you reject a row that has already been committed to Git.** The reject `UPDATE` guards on `status IN ('pending','deferred','approved')`. If the approve path already landed the link in `scripts/temp_info.jsonl`, rejecting in D1 does nothing to Git: `ingest_new.py` will still ingest and publish the game, while `ingest_decisions` records `rejected`, `/api/ingest/known` reports it as handled, and it can never be re-proposed or re-reviewed. This is the design's own "Case B" arriving through the admin UI. Restrict reject to `status IN ('pending','deferred')`; make approved→reject a distinct "revoke" that either refuses, or commits a removal of the line.

**3.3 §2.3 and §4.4 disagree about `commit_jobs`.** The round-trip-2 SQL inserts `(id, kind, status, target_path, requested_by, created_at)`; `openJob(env, {kind, targetPath, requestedBy, queueId, appid})` requires columns that do not exist until 0002. The design flags the ordering hazard (migrate before deploy — correct, `wrangler.jsonc:1-6` confirms push-deploys) but ships two mutually inconsistent statements.

**3.4 `SERVICE_READABLE` needs a Cloudflare change that Design 1 forbids, and it is unnecessary.** `verifyAccessJwt` accepts *any* AUD in the comma list (`access.ts:118-127`), so an ingest-app token already clears signature/aud/iss on `/api/admin/*` — the principal gate is what stops it, and Design 2 is right to add it. But for the canary at `docs/plan/05-ci-automation.md:284` to reach the Worker at all, Cloudflare Access must admit that service token on the `/api/admin` application's policy — exactly the credential-crossing Design 1 §4 rules out. Give the canary a read-only `/api/ingest/ping` on the ingest app and delete `SERVICE_READABLE`.

**3.5 The Origin check breaks the only debugging path that exists.** `if (origin !== env.SITE_ORIGIN || ...) return 403` rejects every non-browser caller, because `curl` and CI send no `Origin` — and `curl` against `/api/admin/health` is what proved this stack works end to end. Allow "`Origin` absent **and** `Sec-Fetch-Site` absent", or document a header. Otherwise every mutating route answers 403 to ops and 404 to everyone else.

**3.6 The wire contract does not match Design 1's producer.** These are the two ends of one endpoint and they disagree:

| | Design 1 sends | Design 2 expects |
|---|---|---|
| envelope | `{source, generated_at, producer{}, sweep{}, candidates}` | `{source, run_id, generated_at, candidates}` |
| per-candidate | `payload: {short_description, genres, …}`, **no** `reviews_raw`/`current_players_raw` | `reviews_raw`, `current_players_raw`, **no** `payload` |
| body cap | client believes 1 MB | server 413s at 512 KB |
| batch cap | ≤ 100 | ≤ 200 |

Design 2's `NormalizedCandidate.payloadJson` has no source field in its own wire format. Reconcile before either is written.

**3.7 `gh()` does not set `Content-Type`.** `authHeaders()` did (`git-data.ts:22-29`); `gh()` (`github-app.ts:126-142`) sets only Authorization/Accept/API-version/UA. Every POST in the port (`/git/blobs`, `/git/trees`, `/git/commits`) must pass it in `init.headers`. Also `gh()` merges via object spread — pass a plain object, never a `Headers` instance, or the headers vanish silently.

**3.8 The `index.json` bump is never named, and the reason it is safe is never stated.** The prompt calls it the only cache-invalidation signal, and it is (`CLAUDE.md:36-39`). In the recovered code, `addLinks` (`edits.ts:445-519`) is the **only** write path that does *not* call `bumpedIndexFile()` — compare `updateGame` (`:142`), `replaceGame` (`:206`), `bulkEditGames` (`:290`), `bulkDeleteGames` (`:384`). Design 2's port drops `bumpedIndexFile` entirely without mentioning it. That is *correct* — the Worker writes only `scripts/temp_info.jsonl`, and `_save_index()` (`data_store.py:158-174`, `"last_updated": now_iso()` at `:167`) does the bump when `ingest_new.py:104` runs `save_main`. But the design should say so, because the invariant is "anything that writes a shard must bump it," and the moment anyone adds a shard-writing route to `WRITABLE_PATHS` the omission becomes a live bug. Add the reason to `lib/repo-paths.ts`'s comment.

**3.9 Backwards comment in `buildTempInfoAppend`.** `catch { /* tolerate a malformed line rather than losing the whole file */ }` — and then the malformed line is written back into `merged`. See §4.4: preserving it is precisely what loses the file.

---

## 4. Operational failures neither design catches

### 4.1 There are FOUR writers to `scripts/temp_info.jsonl`, and one of them truncates it

Design 2 models two (Worker appends, Python clears). The real set:

| Writer | Mode | File:line |
|---|---|---|
| Worker (proposed) | append | — |
| `bot-ingest.yml` | append (`path.open("a")`, one `{"link": …}` per line) | `.github/workflows/bot-ingest.yml:63-68` |
| `ingest-from-issue.yml` | **whole-file overwrite** | `.github/workflows/ingest-from-issue.yml:31` |
| `clear_temp()` | truncate to `""` | `scripts/core/data_store.py:179-183` |

`ingest-from-issue.yml:31` is `fs.writeFileSync('scripts/temp_info.jsonl', m[1].trim() + '\n')`. Any `[add-game]` issue from an `OWNER`/`MEMBER`/`COLLABORATOR` (`:12-15`) **destroys every Worker-appended line that has not been consumed yet**, then ingests only the issue's links, then `clear_temp()`, then `git add . && git push` (`:42-43`). The Worker's candidate is gone with no trace — the diff just shows the file cleared.

Resulting state: `ingest_queue.status='committed'`, `ingest_decisions('approved')` written, appid permanently suppressed from both `/api/ingest/known` and the Worker's suppression check, and the game never enters `data/`. That is Design 2's own §5 "Case B — unsafe, and silently so", reached through a supported, documented workflow with no crash involved.

### 4.2 The push race is not a 422 on the Worker's side — it is a red CI job on the pipeline's side

`grep -rn "pull|rebase" bash/` returns nothing. Every wrapper ends in a bare `git push` under `set -euo pipefail` (`bash/ingest.sh:8`, and the same line in all 11). If the Worker lands a commit between `actions/checkout` and that push, the push is rejected non-fast-forward and the job dies — **after** `ingest_new.py` has spent its whole Steam budget and **after** `clear_temp()` ran locally. Design 2 models only the Worker's half ("a 422 is a normal Tuesday"); the pipeline's half has no retry, no rebase, and no recovery of its own.

The recovery that does exist is accidental: the Worker's push re-triggers `ingest-new.yml` (`:6`), which re-does the work from a fresh checkout. Which brings us to:

### 4.3 `cancel-in-progress: false` does not protect a *pending* run

All 14 data-writing workflows share `group: data-write` with `cancel-in-progress: false` (`ingest-new.yml:9-11` + 13 others; `CLAUDE.md:58-59`). That flag protects the **running** job. GitHub still cancels the **pending** one when a newer run queues into the same group. So a Worker-triggered `ingest-new.yml` that queues behind `update-json` (cron `0 0 * * *`, a ~2-hour job per `CLAUDE.md:59`) is evicted the moment `snapshot-daily` (`0 23 * * *`) or any manual dispatch queues after it.

`ingest-new.yml` has exactly one automatic trigger — `push` on `scripts/temp_info.jsonl` (`:6`). Once that run is evicted, **nothing ever retries it.** The link sits in the file, D1 says `committed`, and there is no alert. `docs/plan/05-ci-automation.md:284` already names "any run in the last 24 h with `conclusion` in `cancelled`/`timed_out`" as a canary; neither design wires it up. Design 2's §3.4 fallback (`schedule: '*/15 * * * *'` on `ingest-new.yml`) would fix this class too, and is worth adopting unconditionally rather than only as a fallback — `ingest_new.py:35-37` already exits cleanly on an empty file.

### 4.4 A single malformed line silently eats the rest of the queue

`load_jsonl` (`data_store.py:61-74`) wraps the **entire** read loop in one `try`. The first `json.loads` failure aborts the read and returns only the lines before it. `ingest_new.py:34` processes that partial list, then `clear_temp()` (`:108`) truncates the whole file — deleting every unread line after the bad one. Nothing reports it beyond one `⚠ Error reading` line in the log.

`ingest-from-issue.yml:31` is a plausible source: it writes the issue's ```` ```json ```` block verbatim, and a pretty-printed block is not JSONL. Design 2's Worker then faithfully preserves that bad line on every subsequent append, making the loss permanent and recurring.

### 4.5 Nothing closes the loop — "committed" means "queued in Git", not "published"

Trace it:

1. Worker commits the link → Design 2 §2.3 round trip 3 sets `ingest_queue.status='committed'` **and** writes `ingest_decisions('approved')`. Both fire on the Git commit.
2. `ingest-new.yml` runs `ingest_new.py`, which re-runs `check_game_health` (`:65`) and **rejects** the candidate into `removed_games.jsonl` if it is `not_free`, `coming_soon`, `unavailable` or `not_found_*` (`:71-77`). The live `scripts/removed_games.jsonl` shows this is the normal outcome, not the exception: 56 `not_free`, 27 `unavailable`.
3. Nothing writes back to D1. `ingest_new.py` has no D1 binding and there is no ingest-side callback in either design.

So for every candidate the Python side rejects, D1 permanently records `approved`, both suppression mechanisms hide it forever, and it is not in the catalogue. The admin's queue shows a clean `committed`.

Design 2's §4.3 `reconcile` is the only machinery that would catch it, and it runs **only over orphans** — `status='pending'` jobs older than ~5 minutes (§4.2). A successfully-settled job is never re-examined. The design's own ordering rule — "step 4 is the only irreversible one, and it runs last" — is violated by its own settle, because the irreversible act (`ingest_decisions`) is taken on evidence that the *link was queued*, not that the *game was published*.

Design 1 §7(c) actually spots the re-check (`ingest_new.py:65`, `:73-77`) and presents it as a safety property. It is — but only if someone acts on the rejection, and nobody does.

**Fix shape.** Settle `commit_jobs` and `ingest_queue.status='committed'` on the commit (that part is right), but do **not** write `ingest_decisions('approved')` there. Instead run reconcile over all rows in `committed` older than ~2 hours: read `data/index.json` + shards (or `scripts/removed_games.jsonl`, which is already allowlisted at `routes/data.ts:20-24`), and write `ingest_decisions('approved')` only for appids that actually landed; flip the rest to `pending` with the pipeline's `status_code` in `reject_reason` so a human sees why. This needs the Worker cron Design 2 already identifies as missing (`wrangler.jsonc` has no `triggers.crons`; `index.ts:16-17` exports only `fetch`).

### 4.6 Undebuggable-by-design, with no compensating signal

From the producer's side, "AUD not appended to `wrangler.jsonc:88`", "wrong service token", "Access policy missing", "route not deployed" and "no such route" are one indistinguishable 404 (`index.ts:39-59` for the existing surface; both designs extend the pattern; Design 2 adds a third 404 on the principal mismatch). Design 1 handles 401/403 well but has **no row for "HTTP 200 with an HTML body"**, which is what an Access login redirect produces — set `allow_redirects=False` and treat any non-JSON 2xx as fatal.

Both designs should add a `GET /api/ingest/ping` returning `{ok, actor, isServiceToken}` — the exact `/api/admin/me` pattern (`admin.ts:50-52`) that made the current stack provable end to end — and have `discover_new.py` call it before spending a single Steam request.

### 4.7 A failing discovery cron is silent

`.github/workflows/notify-ci-failure.yml:12-24` is an **explicit allowlist of workflow `name:` strings**, with a comment warning that renames break it silently. `"Discover New F2P Games"` is not in it, and neither design adds it. (`"Daily Snapshot"` is missing too — pre-existing.) One line, and without it Design 1's careful exit-code taxonomy (0/1/2) reaches nobody.

---

## 5. Ranked must-fix

1. **Do not write `ingest_decisions('approved')` on the Git commit.** Gate it on observing the appid in `data/` or `removed_games.jsonl`. This is the only silent-permanent-loss path in the design (§4.5).
2. **Fix `ingest-from-issue.yml:31` to append, or serialize the Worker with it.** Today it deletes queued candidates (§4.1).
3. **Add `schedule: '*/15 * * * *'` to `ingest-new.yml`** — not as a fallback for the App-token question, but because pending runs in `data-write` get evicted and nothing retries (§4.3).
4. **Restrict Design 2 §2.4 reject to `pending`/`deferred`** (§3.2).
5. **Delete Design 1's `grep` guard docstring collision** — it fails the job on every run (§2.1).
6. **Reconcile the wire contract** between the two designs; they cannot both be implemented (§3.6).
7. **Add `html.unescape()`** to `parse_search_rows`; add `prologue` to the name guard (§2.3).
8. **Keep Design 2's CSRF gate, but allow header-less callers** (§3.5).
9. **Resolve `unavailable`**: either it is a durable rejection or an IP artifact — pick one (§2.2).
10. **Add the new workflow to `notify-ci-failure.yml:12-24`** (§4.7).

Files referenced: `E:\2\web\worker\migrations\0001_init.sql`, `E:\2\web\worker\index.ts`, `E:\2\web\worker\lib\access.ts`, `E:\2\web\worker\lib\github-app.ts`, `E:\2\web\worker\routes\admin.ts`, `E:\2\web\worker\routes\data.ts`, `E:\2\web\wrangler.jsonc`, `E:\2\web\worker-configuration.d.ts`, `E:\2\scripts\ingest_new.py`, `E:\2\scripts\core\data_store.py`, `E:\2\scripts\core\health_checker.py`, `E:\2\scripts\core\steam_client.py`, `E:\2\scripts\core\constants.py`, `E:\2\scripts\purge_unhealthy.py`, `E:\2\scripts\removed_games.jsonl`, `E:\2\bash\ingest.sh`, `E:\2\.github\workflows\ingest-new.yml`, `E:\2\.github\workflows\ingest-from-issue.yml`, `E:\2\.github\workflows\bot-ingest.yml`, `E:\2\.github\workflows\notify-ci-failure.yml`, `E:\2\CLAUDE.md`, `E:\2\docs\ADMIN.md`, `E:\2\docs\plan\03-admin-d1.md`, plus `git show 7729a191:web/src/lib/git-data.ts` and `:web/src/lib/edits.ts`.