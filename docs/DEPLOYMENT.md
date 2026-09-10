# Deployment

The site is a Cloudflare Worker serving a Vite build. Pushing to `main` is what
deploys — there is deliberately no deploy workflow in `.github/workflows/`.

---

## How it fits together

```
push to main
   └─> Cloudflare Workers Builds  (root directory: web)
          npm ci  →  npm run build  →  wrangler deploy
                                          └─> Worker "free-steam-games-list"
                                                ├─ static assets from web/dist
                                                ├─ /api/data/*  → proxies GitHub raw
                                                ├─ /img/*       → proxies Valve's CDN
                                                └─ /admin       → Access-gated (not built yet)
```

`web/wrangler.jsonc` is the only deployment config. Two fields in it are
load-bearing and easy to break:

- **`name` must stay `free-steam-games-list`.** That is the Worker holding the
  `free-steam-games.win` custom domain. Deploying under any other name creates
  a second, domainless Worker and leaves the live site on the old build, with
  a completely green build log.
- **`assets.directory` must be `./dist`, not `.`.** Pointing it at the source
  directory serves an unbuilt `index.html` that references `/src/main.tsx` —
  a blank page — and publishes the whole source tree. This happened.

## Data does not redeploy the site

The catalogue is proxied at `/api/data/*`, not built into `dist/`. A pipeline
commit to `data/**` therefore changes the site's content without any rebuild.

Keep it that way. If the data ever moves into the build output, the Worker's
build watch paths must include `data/**` — otherwise the site silently serves
a frozen dataset with no error anywhere, and a health check that reads the repo
rather than production will report green while it happens.

## Verifying a deploy

```bash
curl -sI https://free-steam-games.win/ | head -3
curl -s  https://free-steam-games.win/ | grep -o '<html lang="[a-z]*"'
curl -so /dev/null -w '%{http_code}\n' https://free-steam-games.win/api/data/data/index.json
curl -so /dev/null -w '%{http_code} %{size_download}b\n' https://free-steam-games.win/img/t/570/header.jpg
curl -so /dev/null -w '%{http_code}\n' https://free-steam-games.win/admin   # expect 404
```

The image should come back around 3–4 KB: the Worker prefers Steam's small
capsule asset over the full header.

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
touching `web/**`: `npm ci`, both typechecks (app and Worker), the build,
`wrangler deploy --dry-run`, and `knip`.

It uses a plain `npm ci`, never `npm ci || npm install`. That fallback is what
hid a lockfile conflict which broke installs for a month.

## Rolling back

Roll back the Worker deployment in the Cloudflare dashboard
(*Workers → free-steam-games-list → Deployments*). Reverting the commit also
works but takes a full build cycle.

GitHub Pages is **not** a fallback. It now serves only a redirect to this
domain; the app cannot run there because it is built with `base: "/"`.

## Secrets

`wrangler.jsonc` holds no secrets — only the D1 `database_id`, which is an
account-scoped identifier and safe to commit. Anything sensitive goes through
`npx wrangler secret put`. See [ADMIN.md](./ADMIN.md).

## Cost notes

Image transformations are **off** (`IMG_TRANSFORM: "false"`), so `/img/*` is a
cached passthrough. Cloudflare Images bills separately from Workers Paid —
5,000 unique transformations a month are free, and there is **no spend cap**.
Measure real `/img/*` volume in Workers Logs before enabling them, and land an
appid allowlist first: without one the endpoint can be pointed at any of
Steam's ~200,000 apps at your expense.
