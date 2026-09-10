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
`web/wrangler.jsonc`. It holds the new-games queue, edit drafts and an audit
log — never game records. Migrations live in `web/worker/migrations/` and are
applied out of band:

```bash
npx wrangler d1 migrations apply f2p-admin --remote
```

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

The name is not cosmetic. `web/wrangler.jsonc` pins
`INGEST_SERVICE_PRINCIPAL: "f2p-discovery"`, and the Worker rejects any other
principal on `/api/ingest/*`. Rename the token and discovery stops working.

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
| `access: aud mismatch` in `wrangler tail` | Application exists, `ACCESS_AUD` is stale | Add its AUD, redeploy |
| `ingest: principal not allowed` in `wrangler tail` | Access authenticated it, but the JWT identity is not in `INGEST_SERVICE_PRINCIPAL` | Copy the logged `got:` value into that var |

`scripts/discover_new.py` decodes the first two from Access's own `meta` JWT and
prints them; the last two only appear in `wrangler tail`.

**The token alone is not enough.** Creating the service token without the
application does nothing: Access only injects a JWT on paths an application
claims, so `/api/ingest/*` stays uncovered, the request arrives at the Worker
bare, and `verifyAccessJwt` returns 404. The symptom is a plain `404` with no
redirect, and it is indistinguishable from a routing bug until you look at the
Worker log.

### Every new Access application needs its AUD added to `ACCESS_AUD`

Easy to miss, and it fails *after* the application starts working - which
makes it look like a different problem entirely.

Each Access application gets its **own** AUD tag. `web/wrangler.jsonc` carries
`ACCESS_AUD` as a **comma-separated allowlist**, and the Worker refuses any
token whose `aud` is not in it. Add an application without extending that list
and every request through it is rejected with `access: aud mismatch`.

You do not need the dashboard to read an AUD. An uncovered path 404s; a
covered one redirects to the login URL with the AUD in its `kid` parameter:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://free-steam-games.win/api/ingest/ping
```

A `404` with no redirect means no application covers the path. A `302` whose
`kid=` value is absent from `ACCESS_AUD` means the application exists but the
Worker will refuse it - add the value and redeploy (`ACCESS_AUD` is a `var`,
not a secret, so a push touching `web/` is enough).

From the Worker's own side:

```bash
cd web && npx wrangler tail --format pretty
```

`hasHeader: false, hasCookie: false` means Access never ran - no application
covers the path. `access: aud mismatch` means it ran and `ACCESS_AUD` is stale.

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

The two credentials are also pinned apart: `verifyAccessJwt` accepts any
configured AUD, so the Worker additionally checks that `/api/ingest/*` is a
service token named `f2p-discovery` and that `/api/admin/*` is not. Without
that pinning, either credential would satisfy the other's routes.

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

`/admin` is the review screen. It is served by the Worker, not by the SPA:
the public app has no sign-in and no editing, so admin markup and admin
endpoint names never enter the bundle visitors download, and `/admin` cannot
fall through to the public app shell if a route changes.

Tabs across the top are the row's status, with live counts:

| Status | Meaning |
|---|---|
| `pending` | proposed by the discovery sweep, awaiting a decision |
| `deferred` | set aside; still blocks the appid from being re-proposed |
| `approved` | committed to the queue file, waiting for the pipeline |
| `committed` | observed in `data/` — genuinely published |
| `failed` | the pipeline looked at it and refused it |
| `rejected` | you refused it; never proposed again |

Select with the checkboxes (or *Select all on this page*, 60 at a time), then
choose an action. The action bar appears only when something is selected.

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
**appended** to, never replaced — the issue workflow and the Telegram bot write
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
On the `failed` tab the middle button becomes **Send back to pending**.

A tick with nothing approved costs one indexed D1 query and no fetches, so the
schedule is close to free.

### If something goes wrong

Every action writes to `audit_log`, and every approval writes a `commit_jobs`
row *before* the commit is attempted, so a Worker that dies mid-flight leaves a
`pending` job as evidence rather than silence:

```bash
npx wrangler d1 execute f2p-admin --remote --command "SELECT status, target_path, commit_sha, error, requested_by, created_at FROM commit_jobs ORDER BY created_at DESC LIMIT 10"
```

If a commit fails the rows are left untouched, on purpose: a row marked
approved with no commit behind it is invisible to both the queue and the
reconciler. Re-approving is safe — already-queued links are skipped.

Read the queue directly with:

```bash
npx wrangler d1 execute f2p-admin --remote --command "SELECT appid, name, release_date, status FROM ingest_queue ORDER BY first_seen_at DESC LIMIT 40"
```

---

## What is not built yet

Editing existing games through the admin screen. The queue covers *new*
games only; corrections to published records still go through Git directly.

`audit_log` has no pruning job yet. It grows only with admin actions, so it is
not urgent, but it is unbounded — decide a retention window and make it agree
with `docs/PRIVACY_POLICY.md` before that matters.
