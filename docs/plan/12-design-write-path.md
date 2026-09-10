# Worker write path — design

Read: `web/worker/index.ts`, `lib/{access,github-app,http}.ts`, `routes/admin.ts`, `migrations/0001_init.sql`, `web/wrangler.jsonc`, `web/worker-configuration.d.ts`, plus `git show 7729a191:web/src/lib/{git-data,edits,jsonl-shard,schema}.ts`, `scripts/ingest_new.py`, `scripts/core/data_store.py`, `bash/ingest.sh`, `.github/workflows/ingest-new.yml`, and `docs/plan/03-admin-d1.md`.

Two things up front, because they change the shape of everything below.

**The Git side is already idempotent, and that decides the crash ordering.** `scripts/ingest_new.py:57-61` skips any appid already in `build_index(load_main())`. So appending a link twice to `scripts/temp_info.jsonl` produces one record, not two. Committing is therefore the *safe* operation to repeat, which means the mandatory order is **open job → commit → settle D1**, never the reverse (§5).

**`docs/plan/03-admin-d1.md` designed an `ingest_batches` table for idempotency; `0001_init.sql` does not have one, and it should stay that way.** The partial unique index at `0001_init.sql:47-49` already gives per-appid idempotency, and it is strictly stronger than a batch key: it dedupes across different batches, different runs and different producers. Batch-level replay protection would only make the *response* stable, not the effect. Don't add the table (§1.4).

---

## 0. Module structure

```
web/worker/
  index.ts                     MODIFIED  — route + principal-gate /api/ingest/*
  env.d.ts                     MODIFIED  — INGEST_SERVICE_TOKEN_ID (var), INGEST_HMAC_SECRET (secret, optional)
  lib/
    access.ts                  unchanged
    github-app.ts              unchanged  — gh() at :126-142 is the whole transport
    http.ts                    MODIFIED   — move json() here from routes/admin.ts:14-24
    ids.ts                     NEW  ~20 loc
    steam-link.ts              NEW  ~50 loc   port of data_store.py:30-43
    audit.ts                   NEW  ~30 loc   lifted from routes/admin.ts:26-39
    git-commit.ts              NEW ~260 loc   port of web/src/lib/git-data.ts @7729a191
    repo-paths.ts              NEW  ~25 loc   write allowlist
  services/
    queue.ts                   NEW ~220 loc   candidate validation + D1 dedupe/insert
    commit-jobs.ts             NEW  ~90 loc   commit_jobs state machine
    approve.ts                 NEW ~180 loc   claim → job → commit → settle
  routes/
    ingest.ts                  NEW ~140 loc   POST /api/ingest/candidates
    admin.ts                   MODIFIED       approve/reject/defer/jobs
  migrations/
    0002_ingest_ops.sql        NEW (small, optional-but-recommended — §4.4)
```

`services/` is a new directory on purpose: `routes/` should stay thin HTTP-shaped code, and the approve orchestration is where the real state machine lives.

---

## 1. `POST /api/ingest/candidates` — the producer

### 1.1 Routing and the principal gate

`web/worker/index.ts:34-37` builds `isAdminApi`/`isAdminPage` and authenticates once before dispatch. `/api/ingest/*` must join that block, or it falls to `index.ts:72-74` and returns 404 forever. `run_worker_first` at `wrangler.jsonc:50` already includes `/api/*`, so the path reaches the Worker.

```ts
// index.ts, replacing lines 34-70
const isIngestApi = pathname.startsWith("/api/ingest/");
const isAdminApi  = pathname.startsWith("/api/admin/");
const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

if (isIngestApi || isAdminApi || isAdminPage) {
  const who = await verifyAccessJwt(request, env);
  if (!who) { /* unchanged: console.warn + opaque 404 */ }

  // Principal separation. verifyAccessJwt proves the caller is SOMEBODY in the
  // Access org; it does not prove they are the RIGHT somebody for this surface.
  if (isIngestApi) {
    if (!who.isServiceToken || who.email !== env.INGEST_SERVICE_TOKEN_ID) {
      console.warn("ingest: wrong principal", { svc: who.isServiceToken });
      return jsonError(404, "not found");
    }
    return handleIngestApi(request, url, env, who);
  }
  if (isAdminApi) {
    // A service token must never approve. GET health/me stay open to it because
    // docs/plan/05-ci-automation.md:284 specifies a CI canary that calls
    // /api/admin/health with service-token headers.
    if (who.isServiceToken && !SERVICE_READABLE.has(route(url))) {
      return jsonError(404, "not found");
    }
    return handleAdminApi(request, url, env, who);
  }
  ...
}
```

`access.ts:135-141` already returns `{ email: common_name, isServiceToken: true }` for service tokens, so nothing in `access.ts` changes.

**Cloudflare-side prerequisite, and it is the one that will bite:** a third Access application on `free-steam-games.win/api/ingest` with a Service Auth policy, and **its AUD tag appended to `ACCESS_AUD` in `wrangler.jsonc:88`**. Miss that and every ingest POST returns an opaque 404 — the exact failure mode already documented at `access.ts:113-117`. `worker-configuration.d.ts:10` currently declares only *one* AUD while `wrangler.jsonc:88` has two, i.e. the generated types are already stale; re-run `npx wrangler types` after adding the var (per the note in `tsconfig.worker.json`).

### 1.2 Payload and caps

```jsonc
{
  "source": "github-actions",            // free text, stored in ingest_queue.source
  "run_id": "18234771902",
  "generated_at": "2026-09-10T00:09:44Z",
  "candidates": [ { "link": "...", "appid": "3210450", "name": "...",
                    "header_image": "...", "release_date": "10 Sep, 2026",
                    "app_type": "game", "is_free": true, "health_status": "ok",
                    "reviews_raw": "N/A", "current_players_raw": "N/A" } ]
}
```

| Cap | Value | Enforcement |
|---|---|---|
| Raw body | 512 KB | `request.arrayBuffer()`, check `byteLength` **before** `JSON.parse` — never trust `Content-Length` |
| `candidates.length` | 200 | 413 `{"error":"payload_too_large","max_candidates":200}` |
| per-candidate serialized `payload_json` | 4 KB | candidate-level reject, not batch-level |
| `name` / `description` | 200 / 2000 chars | truncate |
| queue depth (`status='pending'`) | 1000 | 507 `{"error":"queue_full"}` — backpressure, checked before any write |

200 rather than the plan's 500 because a candidate carries `payload_json` verbatim and the whole batch must fit one D1 `.batch()` transaction and one Worker request.

Per-candidate validation (a bad candidate is rejected individually; only a structurally broken body is a 400):
- `normalizeLink()` port must yield `^https://store\.steampowered\.com/app/\d+/$`, else `bad_link`.
- Client-sent `appid` must equal the server-derived one, else `appid_mismatch`.
- `header_image` host must be one of `shared.akamai.steamstatic.com`, `cdn.akamai.steamstatic.com`, `steamcdn-a.akamaihd.net`, else blanked (not rejected). This matters: the value is rendered in the admin's own browser, and the producer credential is the weakest one in the system.
- `app_type !== "game"` or `is_free !== true` → reject. The Worker re-checks what discovery claims to have already filtered.

### 1.3 Dedupe against both tables, in one round trip each

The blocking constraint is D1's **100 bound parameters per query**, which a 200-appid `IN (?,?,…)` blows through. `json_each` sidesteps it with a single parameter:

```sql
-- open rows (the partial index predicate, spelled out)
SELECT appid, id, status FROM ingest_queue
 WHERE appid IN (SELECT value FROM json_each(?1))
   AND status IN ('pending','deferred','approved');

-- long-term memory
SELECT appid, decision FROM ingest_decisions
 WHERE appid IN (SELECT value FROM json_each(?1));
```

`?1` is `JSON.stringify(appids)` — ~2.2 KB at the 200 cap, far under D1's 100 KB statement limit.

Then one `.batch()` (D1 batches are an implicit transaction, so the whole result is all-or-nothing):

- **new** → `INSERT INTO ingest_queue (...) VALUES (...) ON CONFLICT (appid) WHERE status IN ('pending','deferred','approved') DO NOTHING`. The `WHERE` clause in the conflict target is required to name the partial index at `0001_init.sql:47-49`; without it SQLite cannot resolve the target and the statement errors. `DO NOTHING` (not `DO UPDATE`) is the race backstop for two producers posting concurrently — the SELECT above is the primary dedupe.
- **already open** → `UPDATE ingest_queue SET last_seen_at=?1, seen_count = seen_count + CASE WHEN last_seen_at < ?2 THEN 1 ELSE 0 END WHERE appid=?3 AND status IN ('pending','deferred','approved')`, with `?2 = now-6h`. That debounce is what keeps `seen_count` meaning "showed up on N distinct days, still unreviewed" instead of "the Action retried N times".
- **decided** → no write at all, counted as `suppressed`.
- one `audit_log` row for the batch, with `run_id` and `Idempotency-Key` in `detail_json`.

STRICT tables (`0001_init.sql:44`) make binding hygiene load-bearing: bind `is_free` as `c.is_free ? 1 : 0` (never a JS boolean), and `reviews_pct` / `current_players_num` as `number | null` — never `undefined`, which D1 rejects outright.

Note what the Worker deliberately does *not* do: check the candidate against `data/*.jsonl`. That would cost five ~1.5 MB shard fetches per request. Dedupe against the live catalogue is the producer's job (`discover_new.py` has `load_main()` in hand), and the backstop is `ingest_new.py:57-61`. Consequence worth stating: a leaked ingest token can at worst fill an admin's review screen with noise; it can never create a duplicate record or write to Git.

### 1.4 Posting the same batch twice

Nothing special happens, and that is the design.

- Every appid now has an open row, so the SELECT classifies all of them as duplicates. Response: `inserted: 0, duplicates: N`.
- `seen_count` is bumped at most once per 6 h, so a retry inside the same run doesn't inflate it.
- No `ingest_batches`, no `409 idempotency_key_reused`. `Idempotency-Key` is accepted and logged to `audit_log.detail_json` for traceability only.

The producer must therefore treat a 5xx as "safe to retry" — which it is — rather than expecting a replayed response body.

### 1.5 Response contract

```jsonc
200 { "ok": true, "received": 143, "inserted": 37, "duplicates": 9, "suppressed": 91,
      "rejected": [ { "index": 3, "appid": null, "reason": "bad_link" } ],
      "queue_depth": 58 }
400 { "error": "malformed", "detail": "candidates" }      // structural only
404 { "error": "not found" }                              // auth OR wrong principal — opaque, per index.ts:50-51
413 { "error": "payload_too_large", "max_candidates": 200 }
503 { "error": "unavailable" }                            // D1 down
507 { "error": "queue_full", "queue_depth": 1000 }
```

Every 404 gets a `console.warn` alongside it, same pattern as `index.ts:42-46` — an opaque response is undebuggable from outside by design, so the Worker must say what happened in the logs.

**HMAC (plan §2.3):** optional in v1. It defends only against "service token leaked but HMAC secret didn't". Given that candidates are inert until a human approves, that the batch is capped, and that `header_image`/`link` are validated server-side, one credential is defensible. If added: `X-F2P-Timestamp` within ±300 s, `HMAC-SHA256(secret, ts + "." + rawBody)` over the **raw bytes** (before `JSON.parse`), compared with a constant-time equality — not `===`.

### 1.6 Signature

```ts
// routes/ingest.ts
export async function handleIngestApi(
  request: Request, url: URL, env: Env, who: AccessIdentity,
): Promise<Response>;

// services/queue.ts
export type RejectReason =
  | "bad_link" | "appid_mismatch" | "not_free" | "bad_type" | "dup_in_batch" | "too_large";

export interface NormalizedCandidate {
  appid: string; link: string; name: string; headerImage: string; releaseDate: string;
  appType: string; isFree: 0 | 1; healthStatus: string;
  reviewsRaw: string; reviewsPct: number | null;
  currentPlayersRaw: string; currentPlayersNum: number | null;
  payloadJson: string;
}
export interface RejectedCandidate { index: number; appid: string | null; reason: RejectReason }

export function normalizeCandidate(raw: unknown, index: number)
  : NormalizedCandidate | RejectedCandidate;

export async function partitionAppids(env: Env, appids: string[]): Promise<{
  open: Map<string, { id: string; status: string }>;
  decided: Map<string, "approved" | "rejected">;
}>;

export function insertCandidateStmt(env: Env, c: NormalizedCandidate, source: string, now: string): D1PreparedStatement;
export function touchCandidateStmt(env: Env, appid: string, now: string, bumpBefore: string): D1PreparedStatement;
export async function queueDepth(env: Env): Promise<number>;
```

---

## 2. `approve` / `reject` — the consumer

### 2.1 Routes

`routes/admin.ts:47` slices to a bare route string and compares with `===`; parameterised routes need a matcher. Keep the id pattern tight even though everything is bound:

```ts
const m = /^queue\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject|defer)$/.exec(route);
```

| Route | Method | Body |
|---|---|---|
| `/api/admin/queue/:id/approve` | POST | — |
| `/api/admin/queue/:id/reject` | POST | `{"reason": "…"}` |
| `/api/admin/queue/:id/defer` | POST | `{"until": "ISO"}` (needs 0002) |
| `/api/admin/jobs?status=` | GET | — |
| `/api/admin/jobs/:id/retry` | POST | — |

**CSRF — a real hole that opens the moment these exist.** `access.ts:79-84` accepts the JWT from the `CF_Authorization` **cookie**, which is exactly what a cross-site `fetch`/form POST from any page the admin visits will carry, and Access will proxy that request and inject `Cf-Access-Jwt-Assertion` too — so requiring the header is *not* a defense. Nothing today addresses this because `routes/admin.ts:121-124` (`ping`) is the only POST and it is harmless. Every mutating admin route must gate on:

```ts
const origin = request.headers.get("Origin");
const site   = request.headers.get("Sec-Fetch-Site");
if (origin !== env.SITE_ORIGIN || (site && site !== "same-origin")) return jsonError(403, "forbidden");
```

`SITE_ORIGIN` is already bound (`wrangler.jsonc:72`).

### 2.2 State transitions against the CHECK constraints

`0001_init.sql:34-35` allows `pending | deferred | approved | committed | rejected | failed`. The partial unique index (`:47-49`) covers **`pending`, `deferred`, `approved`** — those three are "open".

```
pending ──approve──► approved ──commit ok──► committed  + ingest_decisions('approved')
   │                    │
   │                    └──commit fail──► stays approved, commit_jobs → failed|conflict
   ├──reject──► rejected  + ingest_decisions('rejected')
   ├──defer───► deferred                     (still open, still deduped)
   └──abandon─► failed    + ingest_decisions('rejected', reason='abandoned')
deferred ──approve|reject──► as above
approved ──retry──────────► re-drives the same commit path, idempotently
```

Three consequences of the index predicate that drive this shape:

1. **`approved` is inside the index.** So the moment a human clicks approve, the appid is still deduped — a concurrent producer batch cannot open a second row for it while the commit is in flight. That is why `approved` is the right claim state, and why claiming and committing can be separate steps.
2. **A failed commit must leave the row at `approved`, not move it to `failed`.** `failed` is *outside* the index, so moving there would un-dedupe an appid whose commit may in fact have landed. Keeping it at `approved` means the row stays deduped, stays visible via `GET /api/admin/queue?status=approved` (which `routes/admin.ts:85-104` already serves), and stays retryable. `ingest_queue.status='failed'` is therefore reserved for **"the admin gave up on this"**, and it *must* be written together with an `ingest_decisions` row — otherwise tomorrow's discovery sweep re-queues it.
3. **`committed` and `rejected` are outside the index**, so `ingest_decisions` (appid PRIMARY KEY, `0001_init.sql:58-64`) is the only thing that stops a re-queue. Write it in the same atomic batch as the transition out of the index — never in a separate round trip.

### 2.3 The claim, and why it is its own round trip

The obvious move — one `.batch()` doing claim + decisions + job — doesn't work: a batch is atomic, so you cannot inspect `meta.changes` on statement 1 and abort statements 2-4. Guarding the later statements with `SELECT … WHERE id=? AND status='approved' AND decided_at=?` almost works, but two approvals landing in the same second with the same actor would both match the guard and open two commit jobs.

So: claim alone, check `changes`, then batch.

```sql
-- round trip 1 — the claim
UPDATE ingest_queue
   SET status='approved', decided_by=?2, decided_at=?3
 WHERE id=?1 AND status IN ('pending','deferred');
```

- `meta.changes === 1` → fresh approval, proceed.
- `meta.changes === 0` → re-read the row. `status='approved'` means this is a **retry** of a stuck approval: skip the claim, proceed to drive the commit (idempotent, §3). Any other status → `409 {"error":"already_decided","status":"…"}`. Row missing → 404.

```sql
-- round trip 2 — one .batch(): evidence before the commit
INSERT INTO commit_jobs (id, kind, status, target_path, requested_by, created_at)
VALUES (?1, 'ingest-approve', 'pending', 'scripts/temp_info.jsonl', ?2, ?3);

INSERT INTO audit_log (actor, action, target, detail_json, created_at)
VALUES (?2, 'queue.approve', ?4, ?5, ?3);
```

Crash between the two round trips leaves a row at `approved` with no `commit_jobs` row — benign, still deduped, and the reconciler recognises it (§4.3).

```sql
-- round trip 3 — settle on success, one .batch()
UPDATE ingest_queue SET status='committed' WHERE id=?1 AND status='approved';

INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
VALUES (?2,'approved',NULL,?3,?4)
ON CONFLICT(appid) DO UPDATE
   SET decision='approved', decided_by=excluded.decided_by, decided_at=excluded.decided_at;

UPDATE commit_jobs SET status='committed', commit_sha=?5, finished_at=?4 WHERE id=?6;

INSERT INTO audit_log (...) VALUES (...);
```

On failure the settle is only `UPDATE commit_jobs SET status=?('failed'|'conflict'), error=?, finished_at=?` plus an audit row. The queue row is untouched.

### 2.4 Reject

One `.batch()`, and both statements matter — `rejected` leaves the index, so the decisions row is what carries the suppression forward:

```sql
UPDATE ingest_queue
   SET status='rejected', decided_by=?2, decided_at=?3, reject_reason=?4
 WHERE id=?1 AND status IN ('pending','deferred','approved');

INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
VALUES (?5,'rejected',?4,?2,?3)
ON CONFLICT(appid) DO UPDATE SET decision='rejected', reason=excluded.reason,
      decided_by=excluded.decided_by, decided_at=excluded.decided_at;

INSERT INTO audit_log (...) VALUES (...);
```

Reject touches Git not at all — no commit job, no GitHub call. 3 row-writes.

**Flag:** `0001_init.sql:58-64` has no `suppress_until`, so a rejection is *permanent*. Un-rejecting is a manual `DELETE FROM ingest_decisions WHERE appid=?`. That is fine for v1 but should be a documented break-glass, and `suppress_until` is on the 0002 list (§4.4).

### 2.5 Signatures

```ts
// services/approve.ts
export interface QueueRow {
  id: string; appid: string; link: string; name: string; status: string;
}
export type ApproveStatus = "committed" | "already_queued" | "conflict" | "failed";
export interface ApproveOutcome {
  ok: boolean; id: string; appid: string; jobId: string;
  status: ApproveStatus; commitSha: string | null; error?: string;
}

export async function approveCandidate(env: Env, queueId: string, actor: string): Promise<ApproveOutcome>;
export async function driveApproval(env: Env, row: QueueRow, actor: string): Promise<ApproveOutcome>;
export async function rejectCandidate(
  env: Env, queueId: string, actor: string, reason: string,
): Promise<{ ok: true; id: string; appid: string }>;
```

---

## 3. The commit

### 3.1 Port `git-data.ts` onto `gh()`, with three changes

The recovered file (`git show 7729a191:web/src/lib/git-data.ts`) is already Workers-portable — `fetch`, `TextEncoder`, `btoa`/`atob`, nothing DOM. Port it as `lib/git-commit.ts` with `gh(env, path, init)` (`github-app.ts:126-142`) replacing `authHeaders(token)` + absolute URLs, so installation-token caching (`github-app.ts:100-123`) stays in one place and no token is ever passed around as a value.

Drop `getFileBlobSha` (`:131`), `buildCommitContent` (`:232`) and the `signer` hook (`:314`, `:348-358`) — the GPG stack was deleted in `64126ffa` and App-token commits are unsigned. Drop `commitFile*` (`:382-420`).

**Change 1 — pin reads to the parent commit.** `git-data.ts:107` hardcodes `?ref=${DEFAULT_BRANCH}`, so the content you read and the parent you build on can be different commits. Take a ref:

```ts
export async function getRepoFileTextAtRef(
  env: Env, pathInRepo: string, ref: string,
): Promise<{ text: string; sha: string } | null>;
```

Also add an explicit `if (data.size === 0) return { text: "", sha: data.sha }`. `scripts/temp_info.jsonl` is a tracked **0-byte** file, and `git-data.ts:118` (`data.encoding === "base64" && data.content`) is false for empty content, silently falling through to a second `/git/blobs` round trip. Correct result, wasted subrequest, and a confusing thing to debug.

**Change 2 — retry must rebuild the content, not just the parent.** This is the real bug in `commitFileWithRetry` (`git-data.ts:402-410`): it retries with the *same pre-serialized bytes*, computed against the old head. Applied to `temp_info.jsonl` that means a retry can resurrect a line the pipeline just consumed, or drop a line another writer added. Take a builder instead:

```ts
export interface CommitBuild { files: { path: string; content: string }[]; message: string }

export async function commitWithRetry(
  env: Env,
  build: (head: RefHead) => Promise<CommitBuild | null>,   // null ⇒ nothing to do, no commit
  opts: { author: { name: string; email: string }; attempts?: number },   // default 3
): Promise<CommitResult | null>;                             // throws RefAdvancedError when exhausted
```

**Change 3 — keep `force: false` hard-wired.** `git-data.ts:287-305` already refuses a `force` parameter, with a comment saying exactly why. Do not reintroduce it in the port; a force-push from an automated approval path silently erases whatever the pipeline committed.

Also add `lib/repo-paths.ts`:

```ts
export const WRITABLE_PATHS: readonly RegExp[] = [/^scripts\/temp_info\.jsonl$/];
export function assertWritable(path: string): void;   // throws otherwise
```

called inside `createTree` for every entry. Contents-write plus a caller-supplied path is remote code execution via CI; the allowlist is the second lock behind the missing Workflows permission.

### 3.2 The build function

```ts
async function buildTempInfoAppend(env: Env, head: RefHead, row: QueueRow): Promise<CommitBuild | null> {
  const cur   = await getRepoFileTextAtRef(env, TEMP_JSONL, head.commitSha);
  const lines = (cur?.text ?? "").split("\n").filter((l) => l.trim());

  const queued = new Set<string>();
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      // BOTH shapes are legal input: ingest_new.py:24-29 accepts a bare link
      // string as well as {"link": ...}. addLinks() only handled the object
      // form, so a bare-string line silently failed its dedupe.
      const link = typeof o === "string" ? o : (o?.link ?? "");
      const a = extractAppid(link);
      if (a) queued.add(a);
    } catch { /* tolerate a malformed line rather than losing the whole file */ }
  }
  if (queued.has(row.appid)) return null;          // already queued at this parent → no commit

  const entry  = JSON.stringify({ link: row.link });   // + MANUAL_FIELDS overrides if the admin set any
  const merged = [...lines, entry].join("\n") + "\n";
  assertWritable(TEMP_JSONL);
  return { files: [{ path: TEMP_JSONL, content: merged }],
           message: `Queue ${row.name || row.appid} for ingest (approved by ${actor})` };
}
```

Appending only `{"link": …}` is deliberate: `ingest_new.py:80-95` builds the full record via `make_skeleton` + `fetch_full` and re-applies MANUAL_FIELDS overrides afterwards, so the Python pipeline stays the only place that knows the record schema. Never write a shard record from the Worker.

The trailing-newline convention round-trips against `clear_temp()` (`data_store.py:179-183`), which writes `""` — the empty-line filter absorbs both.

### 3.3 Sequence and conflict retry

Per attempt, 7 subrequests: `GET /git/ref/heads/main` + `GET /git/commits/{sha}` (that's `getHead`, `git-data.ts:48-59`), `GET /contents/scripts/temp_info.jsonl?ref={head}`, `POST /git/blobs`, `POST /git/trees`, `POST /git/commits`, `PATCH /git/refs/heads/main`. Plus one token mint on a cold isolate.

`updateBranchRef` maps 422 → `RefAdvancedError` (`git-data.ts:301`). On that, sleep `250ms · 2^n` plus jitter and **re-run `build(head)` from a fresh head** — which re-reads `temp_info.jsonl`, so if the pipeline cleared it between attempts the retry appends to an empty file rather than resurrecting consumed lines. Three attempts, then `commit_jobs.status='conflict'` with the observed head sha in `error`, surfaced in `/admin/jobs` with a Retry button. Never force.

Retries are expected here, not exceptional. `ingest-new.yml:9-11`, `update-daily.yml:6-8`, `ingest-from-issue.yml:5-7` and the other data-writing workflows all serialise through the shared `concurrency: {group: data-write}` mutex. **The Worker is a fourth writer sitting outside that mutex**, so a 422 is a normal Tuesday. The browser code's single blind retry (`git-data.ts:402-410`) was never sized for that.

The sleeps are wall-clock, not CPU, so they don't touch the CPU budget.

### 3.4 Permissions: does Contents:write suffice, and will the push fire the workflow?

**Contents: write is sufficient.** The Workflows permission is only required when a commit's tree touches `.github/workflows/**`. This commit writes exactly one path, `scripts/temp_info.jsonl`, and `assertWritable` enforces that before `createTree` — so the App never needs Workflows, and granting it would hand a compromised Worker the ability to rewrite CI. `docs/ADMIN.md:56-66` already records this reasoning; the allowlist is what makes it enforced rather than merely intended.

**A GitHub App installation token's push does trigger workflows.** The "pushes don't trigger workflows" rule is specific to the built-in `GITHUB_TOKEN` (which is why `bash/ingest.sh:8`'s own push doesn't recurse); App installation tokens are not exempt. `ingest-new.yml:6` filters on `push: {branches: [main], paths: ['scripts/temp_info.jsonl']}`, which this commit matches.

> **Flag — documented, not empirically verified in this repo.** `docs/ADMIN.md:56-59` asserts it and GitHub documents it, but nobody has watched an App-token push actually start `ingest-new.yml` here. Verify with one real approval before relying on it. **If it turns out false**, do *not* reach for `workflow_dispatch` — that needs Actions:write, the permission `docs/ADMIN.md:61-66` deliberately withholds. The zero-permission fallback is to add `schedule: cron '*/15 * * * *'` to `ingest-new.yml`; `ingest_new.py:35-37` already exits cleanly on an empty temp file, so a no-op run costs a runner minute and nothing else.

---

## 4. `commit_jobs`

### 4.1 State machine (within 0001's CHECK at `:73-74`)

```
                 ┌──────────► committed   (commit_sha set, finished_at set)
INSERT 'pending' ┼──────────► conflict    (3× RefAdvancedError; error = observed head sha)
  (before any    └──────────► failed      (any other error; error = message, truncated)
   GitHub call)
```

There is no `queued`/`running` — `docs/plan/03-admin-d1.md:604-612`'s `claimJob()` (`WHERE status='queued'`) is not expressible against this schema. It isn't needed either: the claim lives on `ingest_queue.status` (§2.3), and `commit_jobs` is pure evidence, exactly as the comment at `0001_init.sql:67-68` states.

### 4.2 What a half-finished job looks like

**`status='pending'` with `finished_at IS NULL` and `created_at` older than ~5 minutes.** That is the only orphan shape, and it means precisely: *the Worker wrote the job row and then died before settling it.* The commit may or may not have landed — the row cannot tell you, and that is fine, because the answer is cheaply recoverable from Git (§4.3).

### 4.3 Recovery

Both the `/admin/jobs` Retry button and a Worker cron run the same routine:

```ts
export async function findOrphans(env: Env, olderThanIso: string): Promise<JobRow[]>;
export async function reconcile(env: Env, job: JobRow): Promise<"committed" | "redriven">;
```

For each orphan, resolve the paired queue row (needs 0002's `queue_id`; see below), then:

1. Read `scripts/temp_info.jsonl` at current HEAD. Appid present → the commit landed → run the §2.3 settle batch with the head sha and stop.
2. Not present → fetch `data/index.json` + shards via the existing `/api/data/*` proxy (`routes/data.ts:20-24` already allowlists exactly those paths) and check whether the appid is in the catalogue. Present → the pipeline consumed the line → settle to `committed`.
3. Neither → the commit did not land, or landed and was reverted. Re-drive `driveApproval` from the still-`approved` queue row.

Step 3 is safe to run even when steps 1-2 were wrong, for the reason in §5.

`wrangler.jsonc` has **no `triggers.crons` block today** and `index.ts:16-17` exports only `fetch`; the cron needs both a config change and a `scheduled(event, env, ctx)` export. Until that exists, reconciliation is manual via `/admin/jobs`, which is acceptable because the failure is visible rather than silent.

### 4.4 Migration `0002_ingest_ops.sql` — recommended, small

`commit_jobs` in 0001 has no link back to the queue row. Every ingest job has `target_path='scripts/temp_info.jsonl'`, so on recovery you cannot tell which candidate a pending job belonged to. Four columns fix it:

```sql
ALTER TABLE commit_jobs ADD COLUMN queue_id TEXT;      -- ingest_queue.id
ALTER TABLE commit_jobs ADD COLUMN appid    TEXT;      -- denormalised, for reconcile without a join
ALTER TABLE commit_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_queue ADD COLUMN defer_until TEXT;  -- makes 'deferred' auto-expire; §2.2
-- optional: ALTER TABLE ingest_decisions ADD COLUMN suppress_until TEXT;
CREATE INDEX IF NOT EXISTS idx_commit_jobs_open ON commit_jobs (status, created_at) WHERE status='pending';
```

`ALTER TABLE ADD COLUMN` is fine on STRICT tables as long as the added column is nullable or has a default.

**Ship-today fallback without 0002:** set `commit_jobs.id = "${queueId}.${attemptNumber}"` (the column is bare `TEXT PRIMARY KEY`, `0001_init.sql:71`) and recover the queue id by splitting on the last `.`. It works and it is greppable, but it is a string-encoded foreign key — take 0002 instead.

**Ordering is mandatory:** `npx wrangler d1 migrations apply f2p-admin --remote` **before** pushing the code that reads the new columns. Workers Builds deploys on push to main (`wrangler.jsonc:1-6`) and does not run migrations; reverse the order and production throws `no such column` for the length of the build.

```ts
// services/commit-jobs.ts
export type JobStatus = "pending" | "committed" | "conflict" | "failed";
export interface JobRow {
  id: string; kind: string; status: JobStatus; targetPath: string;
  queueId: string | null; appid: string | null; commitSha: string | null;
  error: string | null; requestedBy: string | null; createdAt: string; finishedAt: string | null;
}
export async function openJob(env: Env, i: {
  kind: string; targetPath: string; requestedBy: string; queueId: string; appid: string;
}): Promise<{ id: string }>;
export function settleJobStmt(env: Env, id: string, status: JobStatus,
  o: { commitSha?: string; error?: string; at: string }): D1PreparedStatement;
export async function findOrphans(env: Env, olderThanIso: string): Promise<JobRow[]>;
```

---

## 5. Crash safety end to end

The whole question reduces to: **which side of the Git/D1 boundary is idempotent?** Git is. D1's suppression is not.

**Case A — commit landed, D1 never settled (Worker dies after `updateBranchRef`).**
State: `temp_info.jsonl` has the link; queue row `approved`; job `pending`.
The catalogue is *correct*: `ingest-new.yml` fires, `ingest_new.py` enriches, `save_main()` re-shards, the game is published. Only D1 is stale, and stale D1 shows the row as still-approved, which is honest.
Re-driving is a no-op three times over: `buildTempInfoAppend` sees the appid already queued and returns `null` (no commit at all); or if the pipeline already consumed and cleared the file, the re-append is dropped by `ingest_new.py:57-61` as a duplicate appid. Worst case: one redundant line and one no-op workflow run.
**Safe.**

**Case B — D1 settled, commit never landed.**
State: queue row `committed`, `ingest_decisions('approved')` written, job `committed` with a `commit_sha` that doesn't exist.
The appid is now permanently suppressed — the partial index no longer covers it *and* the decisions row blocks re-insert (§1.3) — while the game never entered `data/`. `/admin/queue` shows it as done. Nothing in the system will ever notice.
**Unsafe, and silently so.**

Therefore the ordering is not a preference:

```
1. claim         ingest_queue: pending → approved         (D1, reversible, still deduped)
2. openJob       commit_jobs: 'pending'                   (D1, evidence before the act)
3. commit        blob → tree → commit → updateRef         (Git, idempotent, retried)
4. settle        committed + ingest_decisions + job       (D1, only after 3 confirms)
```

Steps 1 and 2 are cheap to have run spuriously. Step 3 is cheap to have run twice. Step 4 is the only irreversible one, and it runs last. Every crash therefore leaves the system in a state that is *pessimistic* — something looks unfinished that may in fact be finished — and pessimism is recoverable by re-reading Git, which is the source of truth.

Losing D1 entirely loses the queue and the audit trail and changes nothing about the published catalogue — the invariant `0001_init.sql:1-6` states, still holding after this change.

---

## 6. Rate, size and runtime budgets

**Per ingest request (at the 200 cap):**

| Resource | Cost | Limit |
|---|---|---|
| D1 reads | 3 statements (2 `json_each` SELECTs + 1 COUNT) | — |
| D1 row-writes | ≤ 200 inserts + ≤ 200 touches + 1 audit = **401** | free 100 k/day; paid 50 M/month |
| D1 bound params | 1 per SELECT (via `json_each`), ≤ 14 per INSERT | **100 per query** |
| Subrequests | 0 GitHub calls | 50 free / 1000 paid |
| CPU | `JSON.parse` of ≤ 512 KB + 200 validations ≈ single-digit ms | 30 s paid default |

**Per approve:** 3 D1 round trips (≤ 7 row-writes total), 7 GitHub subrequests per attempt × ≤ 3 attempts ≈ 22, plus ~1.75 s of backoff sleep in the worst case. CPU is negligible — the path is entirely I/O bound, and `fetch` wall time does not count against CPU time.

**Rate limiting must happen before D1.** `docs/plan/10-critique-risk.md:111` is right, and the Worker is the wrong place to do it: there is no KV or Durable Object binding, a per-isolate counter is meaningless across isolates, and a D1-backed counter spends the very budget it is protecting. Use a **Cloudflare WAF rate-limiting rule on `/api/ingest/*`** (e.g. 10 requests / 10 min per IP) — it runs at the edge, before the Worker is invoked and before Access, and it costs nothing. In-Worker backpressure is the queue-depth 507, which is one cheap COUNT.

**Confirm the Worker is on the paid plan before shipping this.** Since 2026-09-01 D1 queries that exceed free daily limits *fail* rather than throttle — including the queries you would use to diagnose it (`docs/ADMIN.md` §6). The 50-subrequest free-tier cap would also break the approve path's ~22 calls at the second retry.

---

## Flags — unverified or requiring out-of-band action

1. **App-token push triggering `ingest-new.yml`** — documented, never observed in this repo. Fallback is `schedule: '*/15 * * * *'` on the workflow, never Actions:write (§3.4).
2. **`ON CONFLICT (appid) WHERE status IN (…)` against D1's SQLite build** — the partial-index conflict target is standard SQLite, but verify on the real database before relying on `DO NOTHING` as the race backstop.
3. **D1 `.batch()` atomicity** — documented as an implicit transaction; the approve settle depends on it, so confirm with a deliberately-failing second statement.
4. **D1's 100-bound-parameter limit** — the `json_each` design assumes it; if the real limit is higher the design still works, just conservatively.
5. **Service-token JWT claim shape** — `access.ts:136-140` reads `common_name`, and `docs/plan/03-admin-d1.md:507` flags this as unverified. Test with a real service token before wiring the `INGEST_SERVICE_TOKEN_ID` equality check, which fails closed to an opaque 404.
6. **Three Cloudflare-side prerequisites, none of them code:** the `/api/ingest` Access application with a Service Auth policy; **its AUD appended to `wrangler.jsonc:88`**; the WAF rate-limiting rule.
7. **`worker-configuration.d.ts` is stale** (line 10 has one AUD, `wrangler.jsonc:88` has two) — re-run `npx wrangler types` after adding `INGEST_SERVICE_TOKEN_ID`.
8. **CSRF on mutating admin routes is currently unmitigated** and becomes exploitable the moment approve/reject ship (§2.1). The Origin / `Sec-Fetch-Site` check is not optional.
9. **`0001_init.sql` has no `defer_until` and no `suppress_until`**, so `deferred` never auto-expires and `rejected` is permanent. Migration 0002 (§4.4), applied *before* the deploy that reads it.
10. **`GET /api/ingest/suppressed`** (`docs/plan/03-admin-d1.md:437`) is not designed here. Without it `discover_new.py` re-posts every rejected appid daily, and the Worker discards them as `suppressed` — correct but wasteful of the producer's Steam call budget. Worth adding once rejection volume is real.
11. **`createCommitOnBranch` (GraphQL) as a future replacement for the 7-call REST sequence** — one atomic request with `expectedHeadOid` CAS and GitHub-side signing. `docs/plan/09-critique-gaps.md:150` flags App-token auto-signing as unverified. Port the REST path first (it is proven code); revisit after.