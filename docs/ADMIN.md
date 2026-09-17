# Admin setup

How the maintainer-only surface is wired: Cloudflare Access in front of
`/admin`, and a GitHub App behind it so the Worker can commit to the
repository.

Nothing here is needed to run or browse the site. The public app is read-only.

---

## Why a GitHub App rather than a token

The site previously kept a GitHub personal access token in the browser's
localStorage on a public origin. That is gone. The replacement needs a
credential that lives only on the server, and a GitHub App is the right shape:

| | Classic PAT | Fine-grained PAT | GitHub App |
|---|---|---|---|
| Expires silently | yes — this stalled the pipeline for a month in Aug 2026 | yes, max 366 days | **no** |
| Scope | whole account | per-repo | per-repo, per-permission |
| Credential at rest | the token itself | the token itself | a private key that mints 1-hour tokens |
| Attribution in history | your account | your account | its own bot identity |

The App's private key never expires; the tokens it mints die in an hour. That
removes the failure mode that already bit this project once.

---

## 1. Create the App

**GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
(<https://github.com/settings/apps/new>)

| Field | Value |
|---|---|
| GitHub App name | `f2p-tracker-admin` (must be globally unique) |
| Homepage URL | `https://free-steam-games.win` |
| Webhook | **Uncheck "Active"** — the Worker calls GitHub, not the reverse |
| Where can this be installed | **Only on this account** |

### Permissions

Under **Permissions → Repository permissions**, set exactly these and nothing
else:

| Permission | Access | Why |
|---|---|---|
| **Contents** | **Read and write** | commit to `data/*.jsonl`, `data/index.json`, `scripts/temp_info.jsonl` |
| **Metadata** | Read-only | mandatory; GitHub adds it automatically |

Leave everything else at **No access**. In particular:

- **Actions — not needed.** A push made with an App installation token *does*
  trigger workflows (unlike the built-in `GITHUB_TOKEN`), so committing to
  `scripts/temp_info.jsonl` starts `ingest-new.yml` on its own. Do not grant
  Actions write just to dispatch runs.
- **Issues, Pull requests, Workflows — not needed.** The Worker only writes
  data files. Granting `Workflows` would let a compromised Worker rewrite
  `.github/workflows/**`, which is the single worst permission to hand out.

Click **Create GitHub App**.

## 2. Collect the credentials

On the App's settings page:

1. Note the **App ID** (a number near the top).
2. **Private keys → Generate a private key.** A `.pem` file downloads. This is
   the credential — treat it like a password. GitHub keeps no copy; if you lose
   it, generate a new one and delete the old.

## 3. Install it on the repository

**Install App** in the left sidebar → your account → **Only select
repositories** → `free-steam-games-list` → Install.

Then note the **Installation ID**, which is the trailing number in the URL of
*Settings → Applications → Installed GitHub Apps → Configure*:
`https://github.com/settings/installations/<INSTALLATION_ID>`.

## 4. Give the Worker the credentials

From `web/`:

```bash
npx wrangler secret put GH_APP_ID
npx wrangler secret put GH_APP_INSTALLATION_ID
npx wrangler secret put GH_APP_PRIVATE_KEY
```

For the private key, paste the **entire** `.pem` including the
`-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines.

Secrets set this way are encrypted at rest and are **not** in `wrangler.jsonc`,
so they never reach the repository. Never put them in `vars`.

The Worker signs a short JWT with the private key, exchanges it for an
installation token, and uses that token for about an hour before minting
another.

## 5. Put Cloudflare Access in front of `/admin`

The App is only half of it — without Access, `/admin` is public.

**Cloudflare dashboard → Zero Trust → Access controls → Applications → Add an
application → Self-hosted.**

| Field | Value |
|---|---|
| Application name | `f2p-tracker-admin` |
| Session duration | 24 hours or less |
| Domain | `free-steam-games.win`, path `admin` |

Add a second application for `free-steam-games.win/api/admin` so the API is
covered too, not just the page.

**Policy:** Action *Allow*, rule *Emails* → your address. Access applications
are deny-by-default, so everyone else gets the login screen and never reaches
the Worker.

Zero Trust's free plan covers up to 50 users, which is 49 more than this needs.

### Two things that are easy to get wrong

- **`workers_dev` must stay `false`.** A zone-scoped Access policy does not
  cover `*.workers.dev`. If that hostname is live, `/admin` is reachable
  around Access, with the repo-write credential behind it.
  `web/wrangler.jsonc` already sets `workers_dev: false` — keep it that way.
- **The Worker must verify the Access JWT itself.** Do not trust the path
  alone. Access forwards a `Cf-Access-Jwt-Assertion` header; the Worker
  validates it against the team JWKS and checks the `aud` claim. Belt and
  braces, because the cost of getting this wrong is repository write access.

Add a second Access identity (a backup email, or a one-time-PIN policy) before
you rely on this. If you lock yourself out, the break-glass path is editing
`data/*.jsonl` directly on github.com — which works precisely because Git, not
D1, remains the source of truth.

## 6. The database

`f2p-admin` (D1, region APAC) already exists and is bound as `DB` in
`web/wrangler.jsonc`. It never holds game records. Its tables:

| Table | Holds | Migration |
|---|---|---|
| `ingest_queue` | candidate games and their review status | `0001_init.sql` |
| `ingest_decisions` | the durable approved/rejected decision per appid | `0001_init.sql` |
| `commit_jobs` | every commit the Worker attempted, written before the attempt | `0001_init.sql` |
| `audit_log` | every admin action | `0001_init.sql` |
| `admin_locks` | the reconcile lease, so the cron and a manual run never overlap | `0002_admin_state.sql` |
| `admin_state` | the dataset generation the last sweep saw | `0002_admin_state.sql` |

(An older version of this page mentioned "edit drafts"; there is no such table.
`/api/admin/edit` commits straight to Git with no draft stage.) Migrations live
in `web/worker/migrations/` and are applied out of band:

```bash
npx wrangler d1 migrations apply f2p-admin --remote
```

The Worker tolerates a missing `0002`: reconcile falls back to its per-isolate
guard and skips the sweep watermark, and `/admin/health` lists the migrations
that are not applied yet. Deploying the Worker before applying the migration is
therefore safe, just degraded.

`audit_log` and `commit_jobs` rows older than `ADMIN_RETENTION_DAYS` (180 by
default, set in `wrangler.jsonc`) are deleted once a day by the cron, and the
deletion itself is recorded as an `admin.prune` audit row. The privacy policy
states the same window; change both together.

Confirm the database is on a paid plan before depending on it: since
2026-09-01, queries that exceed the free daily row limits **fail** rather than
throttle, including the queries you would use to diagnose the problem.

## 7. A service token for the discovery pipeline

`Discover New Games` runs on a GitHub Actions runner. There is no browser and
no human, so it cannot pass an email policy — it needs a **service token**.

**Zero Trust → Access controls → Service auth → Create Service Token.**

| Field | Value |
|---|---|
| Name | `f2p-discovery` |

The name still matters, but on the Cloudflare side only: it is what the Access
policy's *Service Token* rule refers to. Rename the token in Zero Trust without
updating that rule and discovery stops working.

The Worker no longer checks the token's name. It cannot: Access reports a
service token's identity as its opaque Client ID (`<32 hex>.access`), never its
friendly name — undocumented, and established here only by reading
`wrangler tail`. The caller is pinned by AUD instead, which is both correct and
stronger; see the AUD section below.

The client secret is shown **once**. Copy both halves now.

Then add a third Access application covering `free-steam-games.win/api/ingest`,
with a policy of Action *Service Auth*, rule *Service Token* → `f2p-discovery`.

> **The policy Action must be *Service Auth*.** Cloudflare's own docs are blunt
> about it: "Make sure to set the policy action to Service Auth; otherwise,
> Access will prompt for an identity provider login." An `Allow` policy — even
> one carrying a Service Token rule — serves the interactive login page to a
> machine caller, and additionally admits the interactive identities from your
> other policies.

### Telling the three setup failures apart

They all look like "the endpoint is broken". They are not the same problem:

| Symptom | Cause | Fix |
|---|---|---|
| `404`, no redirect | No Access application covers the path | Create the application |
| Redirect to the login page, `service_token_status=False` | Application exists, policy Action is not *Service Auth* | Change the policy Action |
| `access: aud mismatch` in `wrangler tail` | Application exists, but its AUD is not in the var for that route | Add its AUD, redeploy |
| `access: wrong credential class for route` in `wrangler tail` | A human session hit `/api/ingest/*`, or a service token hit the admin routes | Use the right credential; the two are pinned apart on purpose |

`scripts/discover_new.py` decodes the first two from Access's own `meta` JWT and
prints them; the last two only appear in `wrangler tail`.

**The token alone is not enough.** Creating the service token without the
application does nothing: Access only injects a JWT on paths an application
claims, so `/api/ingest/*` stays uncovered, the request arrives at the Worker
bare, and `verifyAccessJwt` returns 404. The symptom is a plain `404` with no
redirect, and it is indistinguishable from a routing bug until you look at the
Worker log.

### Every new Access application needs its AUD added to the var for its route

Easy to miss, and it fails *after* the application starts working - which
makes it look like a different problem entirely.

Each Access application gets its **own** AUD tag, and `web/wrangler.jsonc`
carries two **comma-separated allowlists** — one per route group:

| var | routes it admits |
|---|---|
| `ACCESS_AUD_ADMIN` | `/admin`, `/api/admin/*` |
| `ACCESS_AUD_INGEST` | `/api/ingest/*` |

Add the AUD to the one matching the route the application covers. They are
split rather than pooled deliberately: with a single list any of the three
credentials satisfied any route, so the unattended discovery token would have
satisfied `/api/admin/*`, which holds a credential that can write to this
repository. A token minted for the wrong application now fails verification
outright rather than being caught afterwards.

Add an application without extending the right list and every request through
it is rejected with `access: aud mismatch`.

You do not need the dashboard to read an AUD. An uncovered path 404s; a
covered one redirects to the login URL with the AUD in its `kid` parameter:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://free-steam-games.win/api/ingest/ping
```

A `404` with no redirect means no application covers the path. A `302` whose
`kid=` value is absent from the matching list means the application exists but
the Worker will refuse it - add the value and redeploy (both are `vars`, not
secrets, so a push touching `web/` is enough).

From the Worker's own side:

```bash
cd web && npx wrangler tail --format pretty
```

`hasHeader: false, hasCookie: false` means Access never ran - no application
covers the path. `access: aud mismatch` means it ran and the allowlist for that
route is stale.

Finally, add three repository secrets (**Settings → Secrets and variables →
Actions**):

| Secret | Value |
|---|---|
| `WORKER_BASE_URL` | `https://free-steam-games.win` |
| `CF_ACCESS_CLIENT_ID` | the token's Client ID |
| `CF_ACCESS_CLIENT_SECRET` | the token's Client Secret |

Verify it end to end without touching the queue:

```bash
gh workflow run "Discover New Games" -f dry_run=true
```

### What the token can and cannot do

`/api/ingest/*` writes rows with `status='pending'` and nothing else. It cannot
approve, cannot commit, and cannot reach the repository. A leaked discovery
token buys an attacker a cluttered review screen. The workflows reinforce this
with `permissions: contents: read` and a grep step that fails the run if a
discovery script so much as references a dataset-writing helper.

The two credentials are pinned apart in two independent ways, and neither is
a name check — Cloudflare reports a service token's identity as its opaque
Client ID, not its friendly name, so a name check is not possible:

1. **Per-route AUD.** `verifyAccessJwt` is called with only the AUD group a
   route accepts (`ACCESS_AUD_INGEST` or `ACCESS_AUD_ADMIN`), never a pooled
   list, so a token minted for one application cannot satisfy the other.
2. **Credential class.** `worker/index.ts` additionally refuses a service
   token on the admin surface and a human session on ingest
   (`isIngestApi !== who.isServiceToken`).

An earlier version of this paragraph claimed a `f2p-discovery` name check
and a pooled AUD list. Both were wrong, and it contradicted the accurate
account higher up this page.

## 8. Working through the backlog

Measured 2026-09-10: Steam lists **16,668** free games matching the
catalogue's own filters (`category1=998`, `maxprice=free`,
`supportedlang=english`); `data/` holds **3,424**.

Two jobs close that gap, and they are not the same kind of thing:

| Workflow | Schedule | Lifetime |
|---|---|---|
| `Discover New Games` | daily 05:00 UTC | permanent |
| `Backfill Discovery (TEMPORARY)` | Sundays 17:30 UTC | **delete when the backlog is done** |

For the recent gap — the catalogue's newest record was added 2026-06-30 — run
the daily job once with a deeper sweep:

```bash
gh workflow run "Discover New Games" -f max_pages=10
```

For older windows, dispatch the backfill a quarter at a time:

```bash
gh workflow run "Backfill Discovery (TEMPORARY)" -f year=2026 -f quarter=1
```

It locates the window by binary search over search offsets rather than walking
from page 0 (the store sort is `Released_DESC`, so offset *is* the date axis) —
about 8 page fetches instead of 90 for an old window. A window is finished when
a re-run reports `candidates: 0`; the scheduled run's window is the
`SWEEP_YEAR`/`SWEEP_QUARTER` block at the top of the workflow file, which you
bump as you go.

When the backlog is closed, delete `scripts/backfill_discover.py`, delete
`.github/workflows/backfill-discover.yml`, and drop
`"Backfill Discovery (TEMPORARY)"` from the allowlist in
`.github/workflows/notify-ci-failure.yml`.

---

## 9. Reviewing the queue

`/admin` is the review screen. It is a small Svelte app (`web/admin/`) built
separately from the public site and **embedded in the Worker**
(`worker/generated/admin-bundle.ts`), never placed in `dist/`. Everything in
`dist/` is served to anyone, precached by the service worker and packaged into
the desktop and Android apps, so admin code there would be public whatever
Access says. The Worker serves the app's shell and assets only after the Access
checks, with a per-response nonce CSP, and answers 404 for any other path under
`/admin`.

Tabs across the top are the row's status, with live counts:

| Status | Meaning |
|---|---|
| `pending` | proposed by the discovery sweep, awaiting a decision |
| `deferred` | set aside; still blocks the appid from being re-proposed |
| `approved` | committed to the queue file, waiting for the pipeline |
| `committed` | observed in `data/`, so genuinely published |
| `failed` | the pipeline refused it, **or** nothing observed it within 12h and it aged out. Read `reject_reason` |
| `rejected` | you refused it; never proposed again unless you reopen it |

**Read-only rows.** A row you can no longer decide has no checkbox. It shows a
lock, and *select all* skips it:

- `approved`, `committed` and `rejected` rows are already decided;
- a `pending`, `deferred` or `failed` row whose **game** is already published
  (it has a committed row or an approved decision) is locked too. Approving it
  would queue a link that is already live, and rejecting it would record a
  rejection for a game the catalogue carries.

The server enforces the same rules (`web/shared/queue-rules.ts` is the single
definition both sides import). Anything a decision cannot touch comes back in a
**skipped** list with a reason, never silently dropped: `published`,
`not-decidable`, `open-row-exists`, `duplicate-in-request`, `no-op`,
`changed-concurrently` or `not-found`.

Select rows, then choose an action from the bar that appears at the bottom. A
confirmation lists every row, says what the action will do, and takes an
optional reason. At most 100 rows go into one decision.

Search matches a name or an appid in the current tab; tick *Search every
status* to look everywhere at once. The tab, search, sort, page and page size
are all in the URL, so a reload or a shared link lands on the same view.

Keyboard: `j`/`k` move, `x` selects, `a` approves, `r` rejects, `d` defers (or
sends back to pending), `e` opens the row, `/` searches, `Esc` clears the
selection, `?` lists them. Keys are ignored while you type in a field or while
a dialog is open, and never interrupt IME composition.

Click a game (or press `e`) for its details: the payload as submitted, the
durable decision for the game, and every other row the queue holds for the same
appid. A `rejected` row has **Reopen** there. It moves that one row back to
`pending` and deletes the rejection, but only if no other row for the game is
open or committed and the game has no approved decision; otherwise the dialog
says which of those stopped it. There is no bulk reopen, on purpose.

### The three actions are not symmetric

**Reject** is final and purely local. It writes `ingest_decisions('rejected')`,
which is what stops tomorrow's sweep offering the game again — the partial
unique index only covers *open* rows, so that table is what makes a rejection
stick. The reason box is kept with the decision.

**Defer** just parks the row. It stays open, so the appid remains blocked from
re-proposal and nothing durable is recorded.

**Approve does not publish.** It appends one `{"link": ...}` line per game to
`scripts/temp_info.jsonl` and stops there. What happens next is out of the
Worker's hands: `scripts/ingest_new.py` re-checks each game and can still
refuse it as a duplicate, delisted, not actually free, or unreachable.

That is why an approved row goes to `approved`, not `committed`, and why
nothing writes `ingest_decisions('approved')` at that moment. A commit is a
*request*, not an outcome. Recording it as decided would make a failed ingest
permanently invisible to every future sweep, because `/api/ingest/known`
reports decided appids to the discovery pipeline — the game would vanish with
no error anywhere.

The commit is made with the GraphQL `createCommitOnBranch` mutation, so GitHub
signs it and it shows as **Verified**. It carries `expectedHeadOid`, so if the
pipeline commits between the read and the write the mutation is rejected and
retried against the newer file rather than overwriting it. The file is
**appended** to, never replaced — the browser extension and this Worker write
to it too.

Because the commit comes from a GitHub App installation token rather than
`GITHUB_TOKEN`, it **does** trigger workflows, so `Ingest New Game Links` starts
on its own. (It also runs every three hours as orphan recovery.)

### How a row reaches `committed`

A Worker cron runs every 15 minutes and promotes `approved` rows it can observe
in the published dataset, writing `ingest_decisions('approved')` only then. The
**Reconcile** button runs the same pass immediately, for when you have just
watched the pipeline finish.

A row the pipeline refused becomes `failed` rather than rejected — deliberately,
so one bad day (a delisting, a Steam outage) does not permanently hide a game.
A `failed` row can be approved again, deferred, or sent **Back to pending**.

The same pass also **sweeps** undecided rows. A `pending`, `deferred` or
`failed` row whose game has appeared in `data/` by some other route (the
browser extension, a manual edit) is marked `committed` by `reconcile`, with an
approved decision, so it stops asking for a review it no longer needs. The
sweep reads the dataset only when something is approved, when you press
Reconcile, or when `data/index.json` has changed since the last sweep.

`reject_reason` says which of three things happened:

| `reject_reason` | meaning |
|---|---|
| `rejected by ingest pipeline` | it reached `removed_games.jsonl` after you approved it — not free, delisted, or unreachable |
| `never appeared in data/ or removed_games.jsonl - approve again to retry` | 12h passed and nothing observed it. `ingest_new.py` silently skips an entry that hits a network error and then clears the queue file regardless, so the request is simply gone. **Approve it again** — that re-commits the link |
| `superseded by a duplicate approval` | another row for the same appid was approved instead |

That middle case is why the age-out exists at all. Without it the row would sit
in `approved` forever, and because `/api/ingest/known` counts `approved` as
known, the discovery sweep would never offer that appid again — the game would
be lost silently and permanently.

A tick with nothing approved costs one indexed D1 query and no fetches, so the
schedule is close to free.

### If something goes wrong

Every action writes to `audit_log`, and every commit writes a `commit_jobs`
row *before* it is attempted, so a Worker that dies mid-flight leaves a
`pending` job as evidence rather than silence. Both have their own pages,
filterable and paged: **Jobs** (`/admin/jobs`) and **Audit** (`/admin/audit`).
The queue header warns when any job is `failed` or stuck in `pending`.

**Health** (`/admin/health`) checks D1, the GitHub App installation, the applied
migrations and the reconcile lock live, and still draws its table when the
answer is a 503. **Test write** records a `ping` audit row, which proves the
whole write path from your browser through Access to D1.

If a commit fails the rows are left untouched, on purpose: a row marked
approved with no commit behind it is invisible to both the queue and the
reconciler. Re-approving is safe, because already-queued links are skipped.

If the commit lands but D1 then fails to update the rows, the error says
exactly that, names the commit, and records an `approve.desynced` audit row.
Approving again is safe, and once the pipeline publishes the games the sweep
marks the rows committed on its own.

When the Access session lapses, the page reloads once so Access can sign you in
again. If the API still refuses straight after that reload, the page says so
instead of reloading in a loop.

The same data from the command line:

```bash
npx wrangler d1 execute f2p-admin --remote --command "SELECT status, target_path, commit_sha, error, requested_by, created_at FROM commit_jobs ORDER BY created_at DESC LIMIT 10"
npx wrangler d1 execute f2p-admin --remote --command "SELECT appid, name, release_date, status FROM ingest_queue ORDER BY first_seen_at DESC LIMIT 40"
```

---

## 10. Correcting an existing game

The review queue covers *new* games. Corrections to games already published —
a wrong genre, a note to add, anti-cheat details — go through **overrides**.

An override is not a one-time edit. It is a standing instruction stored at
`data/overrides/<appid>.json`, and `save_main()` re-imposes it on every write
to `data/`. That matters because `MANUAL_FIELDS` are otherwise protected only
by fill-if-empty, which cannot tell a human correction from scraper output —
`normalize_genres.py --apply` rewrites `genre` for every game and would revert
your fix with no error anywhere.

```bash
# what does the catalogue say right now?
python scripts/edit_game.py 730 --show

# correct it, with a reason (kept in the file and visible in git log)
python scripts/edit_game.py 730 --set genre="Tactical Shooter" \
    --reason "Steam's genre list is too coarse" --by you@example.com

# undo: restores the pre-edit value, then permanently stops acting
python scripts/edit_game.py 730 --retire genre

python scripts/edit_game.py --list    # every override
python scripts/edit_game.py --check   # validate them (this runs in CI)
```

The command writes only the override file. `data/` changes on the next
pipeline run, or immediately with `--apply`.

### Three things that will surprise you

**You cannot blank a field with an override.** Setting it to `""` is refused.
The next scrape would refill it and this layer would blank it again, rewriting
shards on every run forever. Use `--retire` to clear.

**Retiring is not the same as deleting the file.** Delete it and the field
stays pinned to your value, because fill-if-empty never brings the old one
back. `--retire` keeps the pre-edit value and writes it back once.

**Editing `notes` keeps the pipeline's own markers.** `notes` is shared: the
pipeline appends `Dead game`, `Delisted` and `No longer free!` segments to it,
and those appends are one-way — once a game is flagged dead the marker is never
re-added. Your text is combined with them rather than replacing them.

### The same thing from `/admin/edit`

`/admin/edit` does exactly what the command above does, and writes a
byte-identical file. A formatting difference between the two producers would
turn every alternating edit into a whole-file diff, so the equality is asserted
by `web/worker/lib/override-doc.test.ts`, which round-trips every committed
`data/overrides/*.json` — all Python-written — through the TypeScript
serialiser and compares bytes. It runs in `web-ci.yml` and in
`check-overrides.yml`.

**One game.** Load a game by appid, or paste its Steam URL. Each field shows
what the catalogue holds now and, where an override is active, its value, the
value from before the first edit, who set it and why. Change what you want, add
a reason, then **Review and save**: a dialog lists every change against the
catalogue and the current override before anything is committed. An overridden
field has **Retire**, which restores the pre-edit value once on the next
pipeline run. Leaving the page with unsaved changes asks first.

**Several games.** Pick games by genre, up to 10 at a time; the selection is
kept across pages and genres. Choose any one field and either set a value or
retire its override, then review: the dialog loads every selected game and
shows what the change does to each, including the ones it leaves unchanged.
One commit, one override file per game.

**Deleting an override file.** Once every entry in a file is retired *and* the
pipeline has restored each value, the file no longer changes anything, and the
page offers **Delete override file**. Until then it says what is still active
or not yet restored, and the Worker checks again against the file as it is at
commit time. (`scripts/edit_game.py` removes a file only when it holds no
entries at all, active or retired, so a file with retired entries stays until
you delete it here.)

The Worker writes only `data/overrides/<appid>.json`; it cannot touch `data/`,
and the page says so rather than letting you assume the catalogue changed.

Two safeguards worth knowing:

- The Worker's validation is a deliberately weaker MIRROR of
  `validate_value()` in `scripts/core/overrides.py`, and the page's own checks
  mirror the Worker's (`worker/routes/edit.test.ts` holds those two equal). They
  exist so you are told immediately. The Python one is authoritative and runs on
  every pipeline write, and `check-overrides.yml` runs it on every push — so
  anything the UI accepts but Python would reject fails CI within a minute
  instead of sitting inert. Change one, change the others.
- `was` is read server-side from the catalogue, never taken from the request.
  It is what Retire restores, so a client-supplied value would let a crafted
  request rewrite history.

---

## Working on the admin locally

A real Worker cannot show the admin locally: every `/admin` and `/api/admin`
request needs an Access JWT, which cannot be minted offline, so `wrangler dev`
answers 404. The admin has its own dev server instead. It runs the **real**
handlers (`worker/routes/admin.ts`, `edit.ts`) against an in-memory D1 with the
real migrations, fed by the real `data/` shards, with GitHub faked. Nothing
leaves the machine and nothing is written to disk.

```bash
cd web
npm run dev:admin       # http://localhost:5174/admin, hot reload, demo data
npm run preview:admin   # the built bundle through the real serveAdmin(), production CSP
```

The demo data (`web/admin/mock/seed.ts`) has every status, rows locked because
their game is published, a rejected row that cannot be reopened, commit jobs in
every state, audit history, and an override on 730 to edit. Two switches, as
cookies set from the browser console:

| Cookie | Effect |
|---|---|
| `mock_github=down` | health reports GitHub unreachable, a 503 (or start the server with `MOCK_GITHUB=down`) |
| `mock_session=expired` | the API answers the way Access does for a lapsed session |

None of this exists in the Worker. Nothing under `worker/` or `admin/src`
imports the mock (`admin/security.test.ts` checks), and there is no flag that
could switch authentication off.

`npm run build` builds the admin after the site, and `npm run typecheck` builds
it first, because the Worker imports the generated bundle.

## Known limits

- **A rejection stays until you reopen it.** There is no `suppress_until`, so a
  game rejected for a temporary reason is not offered again on its own.
- **One field per bulk change.** Several fields on several games means several
  commits.
- **English only.** The admin has one audience, so it has no translations.
