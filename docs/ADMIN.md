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

> Use a *Service Auth* policy, not *Allow*. An `Allow` policy with a service
> token rule still admits the interactive identities on your other policies.

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

## What is not built yet

The Access applications, the GitHub App, the D1 tables and the discovery
pipeline are in place: candidates now arrive in `ingest_queue` on their own.

Still to come is everything on the *human* side of the queue — the `/admin` UI,
and the approve-to-commit path that turns an approved row into a line in
`scripts/temp_info.jsonl`. Until then `/admin` returns a plain-text
confirmation of who you are signed in as, and the queue is read with:

```bash
npx wrangler d1 execute f2p-admin --remote --command "SELECT appid, name, release_date, status FROM ingest_queue ORDER BY first_seen_at DESC LIMIT 40"
```

Note that approval must **not** be recorded as `ingest_decisions('approved')`
at the moment the commit is made. A commit is a request, not an outcome: the
row is only genuinely decided once the appid is observed in `data/` or
`removed_games.jsonl`. Recording it earlier makes a failed ingest permanently
invisible to the next sweep, because `/api/ingest/known` would report it as
already handled.
