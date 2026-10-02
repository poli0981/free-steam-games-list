# Deployment

The site is a Cloudflare Worker serving a Vite build. Pushing to `main` is what
deploys — there is deliberately no deploy workflow in `.github/workflows/`.

---

## How it fits together

```
push to main
   └─> Cloudflare Workers Builds  (root directory: web)
          npm ci  →  npm run build  →  wrangler deploy
                     │                    └─> Worker "free-steam-games-list"
                     │                          ├─ static assets from web/dist
                     │                          ├─ /api/data/*  → proxies GitHub raw
                     │                          ├─ /img/*       → proxies Valve's CDN
                     │                          ├─ /api/human-check → Turnstile siteverify (web only)
                     │                          ├─ /admin       → Access-gated admin SPA (embedded)
                     │                          └─ /api/ingest/* → Access service token
                     ├─ vite build                   → web/dist (the public site)
                     └─ vite build -c admin/…        → web/worker/generated/admin-bundle.ts
```

`web/wrangler.jsonc` is the only deployment config. Several fields in it are
load-bearing and easy to break:

- **`name` must stay `free-steam-games-list`.** That is the Worker holding the
  `free-steam-games.win` custom domain. Deploying under any other name creates
  a second, domainless Worker and leaves the live site on the old build, with
  a completely green build log.
- **`assets.directory` must be `./dist`, not `.`.** Pointing it at the source
  directory serves an unbuilt `index.html` that references `/src/main.tsx` —
  a blank page — and publishes the whole source tree. This happened.
- **`triggers.crons` drives the reconciler.** Remove it and approvals never
  leave the `approved` state: nothing else promotes a row to `committed`, and
  nothing else ages out an approval the pipeline silently dropped. The queue
  keeps working and the failure is invisible until someone opens /admin.
- **`vars.ACCESS_AUD_ADMIN` / `vars.ACCESS_AUD_INGEST` are per-route
  allowlists.** Every Access application has its own AUD; add one without
  listing it here and every request through it is refused with
  `access: aud mismatch`. They are scoped by route on purpose — see
  docs/ADMIN.md.
- **The admin SPA is part of the Worker script, not of `dist/`.**
  `npm run build` runs `build:admin` after the site build, which writes the
  gitignored `worker/generated/admin-bundle.ts` that `worker/index.ts` imports.
  A `wrangler deploy` without that step fails to bundle, and that is the
  intended failure: the alternative, serving the admin from `dist/`, would hand
  its code to anyone, to the service worker's precache and to the packaged
  apps. `scripts/verify-dist.mjs` fails the CI build if any admin code reaches
  `dist/`. The bundle adds about 0.5 MB to the Worker upload.

## Data does not redeploy the site

The catalogue is proxied at `/api/data/*`, not built into `dist/`. A pipeline
commit to `data/**` therefore changes the site's content without any rebuild.

Keep it that way. If the data ever moves into the build output, the Worker's
build watch paths must include `data/**` — otherwise the site silently serves
a frozen dataset with no error anywhere, and a health check that reads the repo
rather than production will report green while it happens.

### The one exception: prerendered game pages

Every `/games/<appid>` page is prerendered on the web build from `data/` as it
stood at build time, so a crawler - which never accepts the terms and never
loads the catalogue - gets real content. Only the slow-changing fields are
baked in (name, description, artwork, studios, genre, platforms, tags); player
counts and reviews always come from `/api/data/*` in the browser.

That snapshot is therefore **as fresh as the last deploy**, and it should stay
that way:

- **The Workers Builds watch paths exclude `data/**`** (dashboard → Worker →
  Settings → Build → Build watch paths). Before they did, every bot data commit
  - several a day - rebuilt and re-uploaded all ~5,700 files (measured on
  2026-10-02: a 4-file data commit re-uploaded 5,681 assets, because
  `kit.version.name` is a timestamp) and gave every open tab a "Reload"
  prompt.
- A game added after the last deploy has no file. The host answers with the
  SPA fallback and `lib/fallback-route.ts` renders it client-side, so it works;
  it simply is not indexable until the next deploy.
- A game removed since the last deploy keeps its file until then. Once the live
  catalogue loads, the page shows "Game not found" with `noindex`.
- `F2P_SKIP_GAME_PRERENDER=1 npm run build` skips them for quick local builds.
  The Tauri builds never prerender them.

### Which commits deploy (build watch paths)

Since 2026-10-02 a commit that touches only documentation or data does not
deploy. That is right for nearly everything outside `web/`, with ONE trap:
**the web build reads the legal documents.** `web/build/legal-versions.ts`
hashes them for the consent gate and `web/src/lib/server/markdown.ts`
renders them at `/legal/*`:

`LICENSE`, `LICENSE-DATA`, `docs/DISCLAIMER.md`, `docs/ToS.md`,
`docs/EULA.md`, `docs/PRIVACY_POLICY.md`, `docs/ACKNOWLEDGEMENTs.md`,
`docs/Contact.md`

A commit that changes only those - the ToS edit Phase B needs, for one - would
not reach the site, and the consent gate would keep showing the old text and
hash until the next code deploy. Either keep those files triggering a build,
or redeploy by hand after merging such a change. Excludes are applied BEFORE
includes, so an exclude like `docs/*` swallows them whatever the include list
says. A configuration that does both jobs:

- Include: `web/*`, `LICENSE`, `LICENSE-DATA`, `docs/DISCLAIMER.md`,
  `docs/ToS.md`, `docs/EULA.md`, `docs/PRIVACY_POLICY.md`,
  `docs/ACKNOWLEDGEMENTs.md`, `docs/Contact.md`
- Exclude: `web/src-tauri/*`, `web/README.md`

Everything not included - `data/**`, `scripts/**`, the other docs,
`CHANGELOG.md`, `CLAUDE.md`, `README.md` - then never deploys. Check it once
by merging a commit that touches only `docs/plan/` (no build) and one that
touches only `docs/ToS.md` (a build).

## Verifying a deploy

```bash
curl -sI https://free-steam-games.win/ | head -3
curl -s  https://free-steam-games.win/ | grep -o '<html lang="[a-z]*"'
curl -so /dev/null -w '%{http_code}\n' https://free-steam-games.win/api/data/data/index.json
curl -so /dev/null -w '%{http_code} %{size_download}b\n' https://free-steam-games.win/img/t/570/header.jpg
curl -so /dev/null -w '%{http_code}\n' https://free-steam-games.win/admin   # expect 302 to Access
curl -so /dev/null -w '%{http_code}\n' https://free-steam-games.win/api/ingest/ping  # expect 302 to Access
```

The image should come back around 3–4 KB: the Worker prefers Steam's small
capsule asset over the full header.

For the AVIF path, copy a game page's hero URL (`/img/d/<appid>/…?t=…`, the
`?t=` matters - it is part of the R2 key) and request it with
`-H "Accept: image/avif"`: once the cron has minted it the answer is
`image/avif` with `X-Img-Final: 1`; before that it is the JPEG with
`Cache-Control: public, max-age=86400` and no `X-Img-Final`.

**A stale service worker will show you the old app after a deploy.** The site
is a PWA, so a browser that visited before the deploy serves its cached shell
until the service worker updates. If you are checking whether a deploy landed,
use a fresh profile or a hard reload — otherwise you will diagnose a
deployment problem that does not exist.

## Local development

```bash
cd web
npm ci
npm run dev          # Vite + HMR; /api/* and /img/* proxy to the live Worker
npx wrangler dev     # the real Worker against web/dist — required for worker/ changes
```

`npm run dev` cannot exercise `worker/` source. It proxies those paths to
production so the app has real data and images; changes under `web/worker/`
need `wrangler dev`.

Stop `wrangler dev` before running `npm ci`. On Windows the install deletes
`node_modules` and fails partway if a dev server holds files open.

## Checks

`.github/workflows/web-ci.yml` runs on pull requests and on pushes to `main`
touching `web/**`: `npm ci`, the typechecks (app, Worker and tests), `npm test`,
the build, `scripts/verify-dist.mjs --web` over the prerendered HTML,
`wrangler deploy --dry-run`, and `knip`. `python-tests.yml` runs the pipeline's
pytest suite on changes under `scripts/`.

It uses a plain `npm ci`, never `npm ci || npm install`. That fallback is what
hid a lockfile conflict which broke installs for a month.

### A red "Workers Builds" check on a PR branch is usually not yours

Cloudflare posts its own check alongside those. On a pull-request branch it has
been seen **failing with zero duration** — `started_at` equal to `completed_at`,
so nothing was compiled and there is no log reachable from GitHub — while the
identical commits built and deployed from `main` minutes later. Measured on
PR #130 (2026-09-20), twice.

Before spending time on it, look at the GitHub Actions `check` job: it already
runs the same `npm run build`, `verify-dist.mjs` and `wrangler deploy
--dry-run`. If that is green, the build is sound and the Cloudflare check is
about the preview build, not your diff. The only place the real answer lives is
the build log in the Cloudflare dashboard, which the check links to.

## Rolling back

Roll back the Worker deployment in the Cloudflare dashboard
(*Workers → free-steam-games-list → Deployments*). Reverting the commit also
works but takes a full build cycle.

GitHub Pages is **not** a fallback. It now serves only a redirect to this
domain; the app cannot run there because it is built with `base: "/"`.

## Secrets

`wrangler.jsonc` holds no secrets — only the D1 `database_id`, which is an
account-scoped identifier and safe to commit. Anything sensitive goes through
`npx wrangler secret put`: the GitHub App's three (see [ADMIN.md](./ADMIN.md))
and `TURNSTILE_SECRET` for the human check (see
[SECURITY_SETUP.md](./SECURITY_SETUP.md) section 12). The Worker declares them
in `web/worker/env.d.ts`.

For `wrangler dev`, put local values in `web/.dev.vars` (gitignored);
`web/.dev.vars.example` holds Cloudflare's always-pass Turnstile test secret.

## Cost notes

**Images.** AVIF copies of the header art are minted by the cron into the R2
bucket `f2p-media` (`web/worker/lib/img-mint.ts`); `/img/*` only reads them, so
requests cannot spend anything - there is nothing for an allowlist to guard.
Images Paid bills $0.50 per 1,000 unique transformations after 5,000 a month
and has **no spend cap**; `IMG_TRANSFORM_MONTHLY_CAP` (a D1 counter) is the
cap. See SECURITY_SETUP.md section 5.

**The bucket must exist before any deploy that binds it.** `wrangler deploy`
fails with code 10085 otherwise (the old Worker stays live). It was created
with `npx wrangler r2 bucket create f2p-media`; keep its r2.dev URL disabled
and attach no custom domain - the Worker is the only reader.

**R2** stays inside the free tier: ~11k objects at ~3-18 KB, about 12 list
calls per cron tick only while minting, and reads only on an edge-cache miss.

**Shard compression is a dashboard setting.** Cloudflare does not compress
`application/x-ndjson` on its own, so the plain shards went out uncompressed
(~9 MiB per full load) until the Compression Rule `ndjson-shards` was added on
2026-10-02: Rules → Compression Rules, `http.request.uri.path.extension eq
"jsonl"` → Custom: Brotli, Gzip. It applies to Worker responses (data_001:
1,497,828 → 225,826 bytes). The packed `/api/data/p1/*.bin` files are
compressed before they are encrypted and are deliberately not `.jsonl`, so the
rule never touches them.
