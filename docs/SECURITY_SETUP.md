# Security setup

What is already enforced in code, and what you still have to switch on in the
Cloudflare dashboard. Every item ends with a command you can run to check it,
because a security setting you believe is on and is not is worse than one you
know is off.

Companion docs: [`ADMIN.md`](ADMIN.md) for Access and the GitHub App,
[`DEPLOYMENT.md`](DEPLOYMENT.md) for the Worker itself.

---

## 1. Response headers — done in code

Two files, and neither inherits from the other:

| File | Covers |
|---|---|
| `web/public/_headers` | static assets (the SPA document, `/assets/*`, icons) |
| `web/worker/lib/http.ts` | everything the Worker generates (`/api/*`, `/img/*`) |

Add a header that must hold everywhere and you must add it in both.

### The CSP

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://cdn.akamai.steamstatic.com;
font-src 'self'; connect-src 'self' https://api.github.com; worker-src 'self';
manifest-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'
```

Verified by loading the built app under it and walking `/games`, four chart
pages, `/about` and `/health`: **zero console errors, zero violations**.

Two directives are the way they are for measured reasons, not by preference:

- **`style-src` needs `'unsafe-inline'`.** Radix (via shadcn/ui) positions
  popovers and dialogs with inline `style` attributes, and ECharts sizes its
  canvas the same way — `/games` alone renders 471 inline-styled elements.
  This is the acceptable half of the trade: the app renders no user-supplied
  HTML, and `script-src` stays strict, which is the directive that actually
  stops code execution.
- **`script-src 'self'` is safe** even though `index.html` contains an inline
  `<script>`: it is `type="application/ld+json"`, a data block that is never
  executed, so `script-src` does not govern it. The built output has no other
  inline script.

`connect-src` allows `https://api.github.com` because the Activity page lists
recent commits and the Android build checks releases. Remove those and you can
tighten it to `'self'`.

### Why there is no CSP on API responses

They are JSON and images, not documents; a policy would govern nothing. The two
HTML pages the Worker *does* serve — `/admin` and `/admin/edit` — build their
own stricter CSP with a per-response nonce.

### Why `Cross-Origin-Resource-Policy` is static-only

The Tauri desktop and Android builds run on `tauri://localhost` and fetch
`/api/data/*` and `/img/*` from this origin **cross-site**
(`SITE_ORIGIN` in `src/lib/fetcher.ts` and `src/lib/image.ts`). `same-site` on
those responses would blank every image and stop the catalogue loading in the
packaged apps. Static assets are only ever loaded by this site, so they can
carry it.

**Check:**

```bash
curl -sI https://free-steam-games.win/ | grep -i "content-security-policy"
```

```bash
curl -sI https://free-steam-games.win/api/data/data/index.json | grep -iE "permissions-policy|cross-origin"
```

The second must print a Permissions-Policy and **no** Cross-Origin-Resource-Policy.

---

## 2. HSTS — already on, and stronger than you may realise

The zone currently sends:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

That is the maximum setting. Two consequences worth a deliberate decision:

- **`includeSubDomains` for a year.** Every future subdomain must be HTTPS from
  the moment it exists. A browser that has seen this header will refuse plain
  HTTP to `anything.free-steam-games.win` for a year, and there is no way to
  shorten that for someone who already received it.
- **`preload` is an invitation.** The domain is **not** on the preload list
  today — verified: `hstspreload.org/api/v2/status?domain=free-steam-games.win`
  returns `"status": "unknown"`. But the list accepts submissions from
  *anybody* for any domain whose header contains `preload` and which meets the
  criteria. Leaving the directive in place means a third party can put you on
  it, and removal then takes months and a browser-vendor process.

**Decide one of two things:**

1. You want preloading → submit it yourself at <https://hstspreload.org>, so it
   happens on your schedule.
2. You do not → **remove `preload` from the header** (SSL/TLS → Edge
   Certificates → HTTP Strict Transport Security). Keep `max-age` and
   `includeSubDomains`; only the invitation goes away.

**Check:**

```bash
curl -sI https://free-steam-games.win/ | grep -i strict-transport
```

---

## 3. Rate limiting — dashboard, not code

The two surfaces that are public and cost money are `/img/*` (proxies Steam's
CDN) and `/api/data/*` (proxies GitHub raw). Everything under `/api/admin/*`
and `/api/ingest/*` is already behind Cloudflare Access and unreachable without
a credential.

**Use a WAF rate-limiting rule, not a Worker-side limiter.** A dashboard rule
rejects at the edge *before* the Worker runs, so an abusive burst costs no
Worker invocations. A limiter inside the Worker has already paid for the
request by the time it says no — precisely backwards for cost control.

**Security → WAF → Rate limiting rules → Create rule**

| | Images | Data |
|---|---|---|
| Name | `img-proxy` | `data-proxy` |
| If incoming requests match | `URI Path starts with /img/` | `URI Path starts with /api/data/` |
| Characteristics | IP | IP |
| Period | 1 minute | 1 minute |
| Requests | **600** | **120** |
| Action | Managed Challenge | Managed Challenge |

Those numbers come from measuring a real session, not from a template: opening
`/games` fetches `index.json` plus 5 shards and roughly 30 thumbnails in one
burst, and scrolling the virtualised table loads more. 600 images/minute is
far above a human browsing hard and far below a scraper. Start with **Managed
Challenge** rather than Block — a shared office or CGNAT address can
legitimately look like one heavy client, and a challenge lets a real person
through.

Watch it for a week under **Security → Events** before tightening.

---

## 4. Bot Fight Mode and the managed WAF

**Security → Bots → Bot Fight Mode: On** (free tier). It challenges obvious
automated traffic before it reaches the Worker.

One caveat that matters here: Bot Fight Mode also challenges *good* bots. The
site publishes a `sitemap.xml` and wants to be indexed, so if you see search
crawlers dropping out of Search Console after enabling it, use **Super Bot
Fight Mode → Allow verified bots** instead, or add a WAF skip rule for verified
search engine crawlers.

**Security → WAF → Managed rules**: enable the Cloudflare Managed Ruleset. This
site has no form posts and no SQL, so the false-positive risk is low.

---

## 5. Cloudflare Images spend

`IMG_TRANSFORM` is `"false"` in `web/wrangler.jsonc`, so `/img/*` currently
passes bytes through and caches them; it does **not** pay for transformations.
Before you ever flip that to `"true"`, understand that Cloudflare Images has
**no spend cap**: 5,000 unique transformations/month are included, and beyond
that it is billed separately from Workers Paid.

**Notifications → Add → Cloudflare Images**, alert at **3,000** unique
transformations. Set this *before* enabling transforms, not after.

---

## 6. Repository hardening

- **Branch protection.** The GitHub App can write to `main`, and so can the
  pipeline. Add a ruleset on `main` that blocks force pushes and deletions
  (Settings → Rules → Rulesets). The Worker never force-pushes —
  `createCommitOnBranch` cannot — so this costs nothing and closes a hole.
- **Delete the retired secret.** The Telegram ingest path is gone:

  ```bash
  gh secret delete TELEGRAM_BOT_TOKEN
  ```

  Then revoke the token itself with Telegram's @BotFather — deleting the
  repository secret does not invalidate it.

**Check what is left:**

```bash
gh secret list
```

Expected: `STEAM_API_KEY`, the three `CF_ACCESS_*`/`WORKER_BASE_URL` discovery
secrets, the four `ANDROID_*` signing secrets, `TAURI_SIGNING_*`, and the
Discord webhooks. Anything else is a leftover.

---

## 7. What is already true, and why

Not everything needs switching on. For the record:

- `/admin`, `/api/admin/*` and `/api/ingest/*` are Access-gated, with **AUDs
  scoped per route** so the unattended discovery token cannot reach the admin
  surface that holds the repository-write credential.
- `workers_dev` is `false`. A zone Access policy does not cover
  `*.workers.dev`, so leaving that hostname live would be a way around Access
  into the Worker holding that credential.
- The Worker can only write two paths — `scripts/temp_info.jsonl` and
  `data/overrides/<appid>.json` — enforced by an anchored allowlist in
  `worker/lib/git-commit.ts`. It cannot touch `data/` shards.
- The discovery pipeline runs with `permissions: contents: read` and a CI step
  that fails if a discovery script references a dataset-writing helper.
- `audit_log` records the acting Access identity and the target, and
  deliberately no IP, User-Agent or country — matching what
  `PRIVACY_POLICY.md` promises.

## Still open

`audit_log` has no pruning job. It grows only with admin actions so it is not
urgent, but it is unbounded — pick a retention window and make it agree with
`docs/PRIVACY_POLICY.md` before it matters.
