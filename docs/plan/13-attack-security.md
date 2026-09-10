## Verdict

Design 2 is materially stronger on security and should be the base. Design 1's security reasoning is the weakest part of an otherwise careful document: its principal check is wrong in both directions, its stated SQL does not implement the suppression its own prose table promises, and it never mentions CSRF. But both designs share one framing error that dominates everything else, so I'll lead with that.

---

## S-1 — CRITICAL. "The App lacks the Workflows permission" is not a boundary. The path allowlist is the *only* lock.

**The attack.** The App has `Contents: read+write`. `.github/workflows/**` is blocked. Nothing else is. `.github/workflows/ingest-new.yml:6` fires on `push: paths: ['scripts/temp_info.jsonl']` and its only step is:

```
run : chmod +x ./bash/ingest.sh && ./bash/ingest.sh
env : { STEAM_API_KEY : '${{ secrets.STEAM_API_KEY }}' }
```

`bash/ingest.sh`, `requirements.txt`, and everything under `scripts/` are all Contents-writable. So a single commit that writes `bash/ingest.sh` (or appends one line to `requirements.txt`) *and* touches `scripts/temp_info.jsonl` is arbitrary code execution on a runner holding `secrets.STEAM_API_KEY` and — via `actions/checkout@v6`'s default credential persistence — a `contents: write` `GITHUB_TOKEN`. `bash/ingest.sh:8` then does `git add .` and pushes whatever the injected code left in the tree.

**Precondition.** Any bug that lets a caller influence which files a commit contains. Design 2 calls `assertWritable` *inside `createTree`* only — the `build(head)` function returns `files[]`, blobs are created from them before `createTree` ever sees a path, and the plan already anticipates a second `commitWithRetry` caller (edit drafts writing `data/*.jsonl`). That caller is the realistic route. Design 1 does not discuss the commit path at all; its §7 "four independent layers" all constrain the *Python script*, none constrain the *Worker*, which is where the credential is.

**Blast radius.** Full CI compromise, `STEAM_API_KEY` exfiltration, arbitrary commits to `main` as `github-actions[bot]`, arbitrary rewrite of the published catalogue.

**Fix.**
1. Validate in `commitWithRetry` over `build()`'s returned `files[]` *and* in `createTree`. Assert `files.length === 1` for `kind='ingest-approve'`.
2. Keep `mode:"100644"`, `type:"blob"` hardcoded — reject any entry carrying a different mode (`120000` symlink, `160000` submodule are both accepted by GitHub's tree API).
3. CI guard in `web-ci.yml`: assert `WRITABLE_PATHS` has exactly one literal entry.
4. **The second lock that does not exist today:** a first step in `ingest-new.yml` that fails the run if the triggering commit touched anything other than `scripts/temp_info.jsonl` — `git show --name-only --format= "$GITHUB_SHA"` compared against an allowlist. Without this there is exactly one lock, in one file, in TypeScript.

---

## S-2 — CRITICAL. `merge_extension_data` turns one temp_info line into permanent control of a published record.

**The mechanism.** `scripts/core/data_store.py:293-316` writes *every* key not in `_SKIP_MERGE_KEYS` (`:278-283`) into the game record; line 316 is a bare `game[key] = val` for unknown keys. `scripts/ingest_new.py:82` passes the temp_info entry straight in. Then `:85` snapshots `MANUAL_FIELDS` **after** the merge and `:93-94` re-applies them **after** `fetch_full` — so injected `notes`, `safe`, `anti_cheat`, `anti_cheat_note`, `is_kernel_ac`, `type_game`, `genre` survive every future refetch, forever.

**Why this is live in Design 2.** `buildTempInfoAppend` is correct today (`JSON.stringify({ link: row.link })`), but the design's own comment says `// + MANUAL_FIELDS overrides if the admin set any`. The only extra data the queue row carries is `payload_json` — which came from the producer, which came from Steam. Implement that parenthetical the obvious way and you hand any Steam publisher permanent write access to `"safe"`, the field this tracker exists to publish. `"safe": "yes"` on a game with a kernel anti-cheat, immune to refetch.

**Fix.** The appended line is built field-by-field from a fixed server-side schema, never spread from client JSON. If overrides land later: source only from a *human-typed* admin request body, intersect with the literal 7-key `MANUAL_FIELDS`, validate per field (`safe ∈ {yes,no,?}`, `is_kernel_ac ∈ {true,false,null}`, `notes ≤ 500` chars, no control characters), and record verbatim in `audit_log`. Independently: change `data_store.py:316` to `continue` for unknown keys — that also closes the same primitive on the `ingest-from-issue.yml` path.

---

## S-3 — HIGH. Design 1's ingest principal check authorises the wrong tokens in both directions.

Adding the ingest app's AUD to `wrangler.jsonc:88` puts it in a flat union checked at `access.ts:118-123`. After that, `verifyAccessJwt` **cannot distinguish an ingest token from an admin token** — only the in-Worker principal check can.

Design 1's check is `if (!who.isServiceToken) return jsonError(404)`. The credential canary specified at `docs/plan/05-ci-automation.md:284` (`GET /api/admin/health` with CF-Access service-token headers) satisfies that exactly — a *monitoring* credential can POST candidates.

The other direction is worse: Design 1 guards only `approve|reject` with `if (who.isServiceToken) return 403`. `/api/admin/queue`, `/api/admin/audit`, and every future admin route stay open to the ingest token. `/api/admin/audit` returns the admin's email and every action taken.

**Fix.** Adopt Design 2's `who.email !== env.INGEST_SERVICE_TOKEN_ID` plus its `SERVICE_READABLE` allowlist. And add the thing neither design has: **the Worker never checks *which human*.** `verifyAccessJwt` checks aud/iss/exp only; every "is this the right person" decision is delegated to the Access policy — the exact delegation `access.ts`'s own header comment says not to rely on. Add an `ADMIN_EMAILS` var and require `who.email ∈` it for `/api/admin/*` and `/admin`. That makes the principal test a positive allowlist, which also fixes S-4.

---

## S-4 — HIGH. `isServiceToken` fails **open** on the admin side, and both designs bet on it.

`web/worker/lib/access.ts:135-140`:

```ts
const email = typeof claims.email === "string" ? claims.email : null;
const commonName = typeof claims.common_name === "string" ? claims.common_name : null;
if (email) return { email, isServiceToken: false };
if (commonName) return { email: commonName, isServiceToken: true };
```

`common_name` is consulted only when `email` is falsy. Both designs list the service-token claim shape as unverified. Neither notes that the two directions fail differently:

- Design 1's `/api/ingest` gate (`!who.isServiceToken → 404`) fails **closed**. Producer breaks. Safe.
- Design 2's `/api/admin` gate (`who.isServiceToken && !SERVICE_READABLE.has(route)`) fails **open**. If a service-token JWT carries a non-empty `email`, the token is classified as a human and `POST /api/admin/queue/:id/approve` succeeds — a credential sitting in GitHub Actions secrets commits to `main`.

**Fix.** Reverse the precedence (check `common_name` first), *and* make the admin gate a positive human allowlist per S-3 so the classification is not load-bearing. Verify the claim shape against a real token before either design ships — and record the finding as "if this is wrong, approve is reachable from a CI secret", not "TBD".

---

## S-5 — HIGH. CSRF. Design 1 never mentions it; Design 2's fix is right but in the wrong place.

`access.ts:83` accepts the JWT from the `CF_Authorization` **cookie**. Access proxies a cross-site POST and injects `Cf-Access-Jwt-Assertion` itself, so requiring the header is not a defence. Today the only POST is `ping` (`admin.ts:121-124`) and it is harmless — which is why nothing addresses this yet.

**The request that exploits it**, from any page the admin visits:

```js
fetch("https://free-steam-games.win/api/admin/queue/<uuid>/approve",
      {method:"POST", credentials:"include", mode:"no-cors"});
```

The attacker needs a queue id. Every appid they pushed through the ingest path is one they know is pending; ids are UUIDs but the endpoint distinguishes 404 / 409 / 200, so a supplied candidate plus `GET /api/admin/queue` timing is enough, and a determined attacker just needs the admin to visit once with a few thousand guesses in flight. Chain with S-2 and it is forced publication of an attacker-authored record.

Design 2's `Origin === env.SITE_ORIGIN` + `Sec-Fetch-Site` check is correct and fails closed on a missing `Origin`. But Design 2 places it "on every mutating admin route" — per-handler, which is precisely the pattern `index.ts:29-33` and `admin.ts:1-8` were written to forbid. Put it in `index.ts` beside `verifyAccessJwt`, so the next route added inherits it:

```ts
if (isAdminApi && request.method !== "GET" && request.method !== "HEAD"
    && !who.isServiceToken && request.headers.get("Origin") !== env.SITE_ORIGIN) {
  return jsonError(403, "forbidden");
}
```

---

## S-6 — HIGH. Steam `short_description` is HTML and it is headed for the admin's browser.

`appdetails` returns markup in `short_description`/`about_the_game`. Both designs store it verbatim in `payload_json` (length caps do not help). The review screen's entire purpose is to render it. The first `dangerouslySetInnerHTML` on a candidate description is stored XSS on `free-steam-games.win`, executing in the one browser holding a live `CF_Authorization` cookie, on the origin that fronts a repo-write credential — and same-origin defeats the S-5 `Origin` check, so self-approve is one `fetch` away.

**Precondition: a published Steam store page.** $100 Steam Direct, self-serve. This is the only fully-external attacker path in the whole design and it deserves more than Design 2's one-line "the producer credential is the weakest one in the system".

`web/worker/lib/http.ts:6-10` sets `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options` — **there is no `Content-Security-Policy` at all.**

**Fix.** Strip tags server-side at ingest before storing (`String(x).replace(/<[^>]*>/g, "")`); render as text; and add to `SECURITY_HEADERS` now, not when the UI is built: `default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'`.

---

## S-7 — MEDIUM. The `header_image` allowlists disagree with the Worker's own proxy, and Design 2's is wrong.

`web/worker/routes/img.ts:14-18` names exactly two hosts — `shared.akamai.steamstatic.com` and `shared.fastly.steamstatic.com` — and its docstring records that fastly serves ~1,496 of 3,423 records (44%).

- **Design 2's list omits `shared.fastly.steamstatic.com`.** It blanks the header image on roughly half of all real candidates, and the reviewer approves blind — which is a security failure, not a cosmetic one, since the image is the reviewer's main signal that the candidate is what it claims.
- Design 1 caught fastly, but adds `cdn.akamai.steamstatic.com` and `steamcdn-a.akamaihd.net`, which `img.ts` will not proxy — those either break or get fetched cross-origin from the admin page.

**Fix.** `export const SOURCE_HOSTS` from `img.ts`; import it in the ingest validator. One list, one file, guaranteed not to drift from what the proxy will actually serve.

---

## S-8 — MEDIUM. `preview_urls` is not disabled. `workers_dev: false` does not cover it.

`wrangler.jsonc:24` sets `workers_dev: false` with a comment about Access not covering workers.dev. `preview_urls` is a **separate** key — `web/node_modules/wrangler/wrangler-dist/cli.d.ts:1693`: *"Whether we use `<version>-<name>.<subdomain>.workers.dev`"* — it is absent from `wrangler.jsonc`, and it defaults to true. `docs/plan/01-cloudflare-platform.md:448` confirms non-production branches switch to `wrangler versions upload`, which is exactly what mints those hostnames. `docs/ADMIN.md:125-128` documents the `workers_dev` rule and is silent on preview URLs. `docs/plan/03:704` says "same applies to any preview/version URL Workers Builds generates. Audit those" — nobody has.

**What it does *not* achieve, credit where due:** it is not an auth bypass. `verifyAccessJwt` runs regardless, and a stolen *service token* (client-id + secret) is useless there because there is no Access in front to exchange it for a JWT. The Worker-side verification is what makes this survivable and both designs are right to keep it.

**What it does achieve, concretely:**

1. **Design 2's only rate limit is a Cloudflare WAF rate-limiting rule (§6). WAF rules are zone-scoped and do not apply to `*.workers.dev`.** The single control protecting D1 from S-9 is absent on a hostname that is live right now.
2. `/api/data/*` and `/img/*` on a preview URL are an unauthenticated, un-WAF'd proxy billing the paid Worker per request — and once `IMG_TRANSFORM` flips to `"true"`, billing image transformations against an account Cloudflare gives no spend cap.
3. **Access revocation stops working.** `verifyAccessJwt` checks signature/aud/iss/exp and nothing else. Revoking a service token or removing a user in Zero Trust does not invalidate an already-minted JWT; on the zone Access refuses to proxy it, on a preview URL there is no Access to refuse. A revoked identity keeps write access until `exp`.

**Fix.** `"preview_urls": false` in `wrangler.jsonc` beside `workers_dev`, same comment; add it to the `docs/ADMIN.md:125` rule; and move the rate limit out of the WAF (below).

---

## S-9 — MEDIUM/HIGH. The duplicate flood: 507 backpressure never fires, D1 dies anyway.

Design 2 §1.3 issues `touchCandidateStmt` — an UPDATE per already-open candidate. Duplicates do **not** raise `status='pending'` depth. So the queue-depth-1000 → 507 gate, checked before any write, never trips for a batch of 200 appids that are all already queued. 200 row-writes per request, unbounded requests, queue depth constant at whatever it was.

Free-tier D1 is 100k row-writes/day and since 2026-09-01 over-limit queries **hard-fail** (`docs/plan/03:714`). ~500 requests takes the admin plane down — including `/api/admin/health`, `/queue` and `/audit`, i.e. every query you'd use to diagnose it — until 00:00 UTC. Precondition: the ingest service token, which the plan itself (`03:710`) notes lives beside workflows that interpolate secrets into shell command lines.

Design 2's own 6-hour debounce is `SET seen_count = seen_count + CASE WHEN last_seen_at < ?2 THEN 1 ELSE 0 END` — **it still writes the row every time.**

**Fixes, cheapest first.**
1. Move the predicate into the WHERE clause: `... WHERE appid=?3 AND status IN (...) AND last_seen_at < ?2`. A debounced touch becomes 0 row-writes. That alone reduces the flood to 1 audit row per request.
2. A real limiter that is not the WAF (S-8): a Durable Object counter, or one guarded D1 row keyed on `who.email` + hour, checked before the batch, costing 1 write.
3. **Cap `audit_log.detail_json`.** Both designs log the client-supplied `Idempotency-Key` into it, unbounded, into a `STRICT TEXT` column with no length constraint. `Idempotency-Key: <100 KB>` is a free storage amplifier toward D1's 5 GB cap. Truncate to 128 chars, and validate against `/^[A-Za-z0-9._-]{1,128}$/`.

---

## S-10 — MEDIUM. Both designs' caps are internally inconsistent, so the per-candidate cap is decorative.

- Design 1: `candidates ≤ 100`, `payload_json ≤ 32 KB`, `body ≤ 1 MB`. 100 × 32 KB = 3.2 MB. The body cap always binds first; the 32 KB cap can never bind at the stated batch size.
- Design 2: `candidates ≤ 200`, `payload_json ≤ 4 KB`, body 512 KB. 200 × 4 KB = 800 KB > 512 KB. Same.

A producer that trips the body cap gets a 413 on a batch every candidate of which is individually legal; Design 1's client then halves and retries, which is correct recovery only if the caps are consistent. Pick a set that composes: body ≤ 512 KB, candidates ≤ 200, `payload_json` ≤ 2 KB.

Separately: Design 2 correctly enforces the byte cap on `request.arrayBuffer().byteLength` **before** `JSON.parse`. Design 1 does not say where its 1 MB check happens — if it's `Content-Length`, a chunked request bypasses it entirely and you `JSON.parse` an attacker-sized body inside the CPU budget.

---

## S-11 — MEDIUM. A rejected appid can be resurrected, and Design 1's SQL never checks suppression at all.

Both designs read `ingest_decisions` in a SELECT and then INSERT in a separate statement. A reject committing in that window re-queues the appid as `pending` with `seen_count: 1` — indistinguishable from a fresh candidate, in front of the same reviewer who just rejected it.

Worse: Design 1's *stated* INSERT contains no `ingest_decisions` reference whatsoever —

```sql
INSERT INTO ingest_queue (...) VALUES (?1,...,'pending',?8,?8,1)
ON CONFLICT(appid) WHERE status IN (...) DO UPDATE SET last_seen_at = ..., seen_count = ... + 1;
```

— while its prose table promises "appid present in `ingest_decisions` → skip, count as `suppressed`". Prose that the SQL doesn't implement is the kind of gap that ships.

**Fix (free, no extra round trip):**

```sql
INSERT INTO ingest_queue (id, appid, ...)
SELECT ?1, ?2, ... WHERE NOT EXISTS (SELECT 1 FROM ingest_decisions WHERE appid = ?2)
ON CONFLICT (appid) WHERE status IN ('pending','deferred','approved') DO NOTHING;
```

Design 2 gets the structural half right where Design 1 is silent: `rejected`/`committed`/`failed` sit outside `uq_queue_open_appid` (`0001_init.sql:47-49`), so `ingest_decisions` is the *only* suppression, and any transition out of the index that is not in the same `.batch()` as its decisions row leaves the appid re-queueable.

---

## S-12 — MEDIUM. Approve replay converges, but only because of one line the design describes as an optimisation.

Two concurrent approves on the same queue id: D1 serialises the claim UPDATEs, one gets `changes===1`, the other gets 0, re-reads `status='approved'`, and Design 2 explicitly instructs it to "skip the claim, proceed to drive the commit". **Both requests then drive a commit.** They converge only because (a) `buildTempInfoAppend` re-reads the file at the fresh head and returns `null` when the appid is already present, and (b) `updateBranchRef` is a CAS with `force:false`.

That `return null` is a concurrency control, not the "nothing to do, no commit" optimisation the design calls it. Someone will later cache the file text across retries or skip the read on attempt 0, and reintroduce double-commit silently.

**Fix.** Say so in the comment, and add a free mutex: `commit_jobs.id = queueId` (not a fresh UUID) so a second concurrent drive hits the PRIMARY KEY and aborts. Design 2's §4.4 fallback already proposes `"${queueId}.${attempt}"`; drop the suffix for attempt 0. Also: the `changes===0` re-drive path has **no bound** on how many times a stuck `approved` row can be re-driven, at up to 21 GitHub subrequests each. `commit_jobs.attempts` must be *checked*, not just incremented.

---

## S-13 — MEDIUM. The installation-token mint is the scarce resource, and neither design protects it.

A single-repo App installation gets the floor of ~5,000 requests/hour. Approve is ~7 subrequests × up to 3 attempts, so ~240 approvals/hour exhausts it — and the exhausted state also breaks `/api/admin/health` (`admin.ts:70` calls `gh()`), so the symptom presents as a mis-scoped App.

Scarcer still: `github-app.ts:104` mints via `POST /app/installations/{id}/access_tokens`, and `tokenCache` (`:16`) is a module-global — **per isolate**. A burst, or simply traffic spread across colos, mints a fresh token per cold isolate against a separately rate-limited endpoint. Design 2 notes "plus one token mint on a cold isolate" in its budget table and moves on.

**Fix.** Cache the installation token in D1 (or KV) keyed by expiry so isolates share one; never retry the mint inside a request; persist the attempt count.

**What is fine, and worth stating because Design 2 half-relies on it:** `/api/data/*` proxies `raw.githubusercontent.com` **unauthenticated** (`routes/data.ts:13`), so reconcile step 2 does *not* burn the App's budget. But it reads through a 300 s edge cache plus raw's own CDN cache, so "is this appid in the catalogue" is up to ~5 minutes stale and reconcile will re-drive commits that already landed. Harmless under §5's ordering, but the design presents step 2 as authoritative and it is not — use `gh()` against `/contents/data/index.json` if you want an authoritative read.

---

## S-14 — MEDIUM. Audit gaps: every denial is invisible, and the reconciler acts with no actor.

1. **`audit()` (`admin.ts:26-39`) is only called on success paths.** A wrong-principal 404, a CSRF 403, a 413, a 507 — none write a row. `console.warn` goes to Workers Logs, retained days, sampled by `head_sampling_rate` (currently 1, but that is a dial someone turns down for cost). So "was the ingest token used by someone other than the workflow?" is **not answerable from `audit_log`**. Fix: write an `auth.denied` / `principal.mismatch` row on every post-JWT denial (actor = presented `common_name`/`email` or `"anonymous"`, target = pathname), rate-limited to one row per identity per minute so it doesn't become its own write amplifier (S-9).
2. **`reconcile()` takes an action with no audit row.** Design 2's cron settles `ingest_queue.status='committed'` and writes `ingest_decisions('approved')` — permanently suppressing an appid — with no human in the loop and no specified audit entry. Fix: `actor='system:reconcile'`, `detail_json` carrying the job id and the evidence that decided it.
3. **The break-glass un-reject is unauditable.** Design 2 §2.4 documents `DELETE FROM ingest_decisions WHERE appid=?` via `wrangler d1 execute`. Make it a route (`POST /api/admin/decisions/:appid/clear`) so it writes an audit row; document direct SQL as forbidden.
4. **What is genuinely strong:** every approval also leaves a Git commit authored by the App carrying the actor's Access email. That is an audit record D1 cannot silently rewrite. Which makes S-15 matter more than it looks.

---

## S-15 — LOW/MEDIUM. Commit-message injection from Steam-controlled text.

Design 2: `` `Queue ${row.name || row.appid} for ingest (approved by ${actor})` ``. `row.name` originates from the store page. `createCommit` strips only *trailing* newlines (`git show 7729a191:web/src/lib/git-data.ts`, the `message.replace(/\n+$/, "")` in the `createCommit` body). A store title containing `\n\nCo-authored-by: someone <someone@example.com>` writes a forged trailer into `main`'s history — the one part of the audit trail D1 cannot rewrite (S-14).

**I checked the escalation and it does not exist, so don't over-rate this:** no workflow interpolates `github.event.head_commit.message` into a `run:` block (grep across `.github/workflows/` returns only `github.run_id`, `github.event.issue.number`, and matrix/ref values), and no Python script shells out (`grep -rn "subprocess\|os.system\|shell=True" scripts/` is empty). This is attribution/log spoofing, not RCE.

**Fix.** `row.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 72)`, and put the queue id and appid in the message body where they're machine-readable.

---

## S-16 — LOW. `access.ts` fails open on a non-numeric `exp`.

`web/worker/lib/access.ts:132-133`:

```ts
if (typeof claims.exp === "number" && claims.exp < now) return null;
if (typeof claims.nbf === "number" && claims.nbf > now) return null;
```

A token whose `exp` is a string, or absent, is accepted forever. Cloudflare emits numeric today so this is not exploitable now — but it is a fail-open default in the single function that is about to gate a repo-write credential. `if (typeof claims.exp !== "number" || claims.exp < now) return null;`. Neither design bounds token *age* for the write path either; requiring `exp - now < 24h` on `/api/ingest/*` and on mutating admin routes costs one line and caps the S-8 revocation window.

---

## S-17 — LOW. `gh()` does no path encoding, and only the write side is allowlisted.

`github-app.ts:126-142` concatenates `path` onto `https://api.github.com`. Design 2's `getRepoFileTextAtRef(env, pathInRepo, ref)` builds `/repos/o/r/contents/${pathInRepo}?ref=${ref}` with neither `encodeURIComponent` nor an allowlist check — `assertWritable` covers only `createTree`'s entries. Both arguments are constants today; the hazard is S-1's shape, i.e. the next caller. Fix: `assertReadable`/`assertWritable` on every path reaching `gh()`, and `encodeURIComponent` each segment.

---

## S-18 — LOW. Two allowlist regex traps.

- `/^scripts\/temp_info\.jsonl$/` is correct in JS (`$` matches end-of-input without `m`). The same pattern ported to Python matches `"scripts/temp_info.jsonl\n"` because Python's `$` also matches before a trailing newline — use `\Z`. Worth a comment, because Design 1 proposes an equivalent Python-side check.
- Design 1's `--json-out` guard ("rejects any path under `data/` or `scripts/temp_info.jsonl` — argparse-level assertion, not a convention") is specified as prose with no normalisation. `--json-out scripts/../data/x.jsonl`, an absolute path, or a symlink walks straight through a naive `startswith`. If you keep the check, it must be `os.path.realpath` + `os.path.commonpath` against the repo root.

---

## Scorecard

| | Design 1 (`discover_new.py`) | Design 2 (Worker write path) |
|---|---|---|
| Path allowlist | absent (out of scope, but §7 claims coverage it doesn't have) | present, but enforced in one place only — S-1 |
| Principal separation | **wrong in both directions** — S-3 | correct — adopt this |
| `isServiceToken` fail direction | fails closed | **fails open** — S-4 |
| CSRF | **not mentioned** | found it; wrong placement — S-5 |
| Suppression in SQL | promised in prose, **absent from the statement** — S-11 | present, TOCTOU-able — S-11 |
| `header_image` allowlist | correct (has fastly) | **missing fastly** — S-7 |
| Steam HTML → admin browser | unaddressed | unaddressed — S-6 |
| Crash ordering / idempotency | n/a | correct, and the reasoning is right |
| `force: false` | n/a | correctly refused to reintroduce |

**The one change worth more than all the others:** stop treating "the App has no Workflows permission" as a security boundary. `ingest-new.yml` executes `bash/ingest.sh` and `requirements.txt`, both of which the App can rewrite. The boundary is a one-entry path allowlist enforced at two layers in the Worker, plus a check inside `ingest-new.yml` on what the triggering commit actually touched. Design 2 states this half-way ("the second lock behind the missing Workflows permission"); it is the first and currently the only lock.