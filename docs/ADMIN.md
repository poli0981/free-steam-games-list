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

---

## What is not built yet

The Access application, the GitHub App and the D1 tables are the prerequisites.
The `/admin` UI, the queue schema and the approve-to-commit path are still to
come; `/admin` currently returns 404 by design rather than serving the public
app shell.
