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

It is set by the **Cloudflare zone** (SSL/TLS → Edge Certificates → HTTP
Strict Transport Security), not in `web/public/_headers` or the Worker — on
purpose. The zone setting stamps every response, static and Worker-generated
alike, and any subdomain created later. Setting it in code as well would mean
keeping two files in step and risking a second `Strict-Transport-Security`
header, of which browsers honour only the first. Verified live on `/`,
`/api/data/*` and `/assets/*`: all three carry the value above.

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

## 3. Rate limiting — one rule, and it blocks

The Free plan allows exactly **one** rate-limiting rule, and fixes most of it:
counting by IP only, a **10-second** period, a **10-second** mitigation
timeout, expression fields limited to the URI path and verified-bot status,
and cached requests count too. So the decision is not how many rules but what
the single rule covers.

The two public surfaces that cost money are `/img/*` (proxies Steam's CDN) and
`/api/data/*` (proxies GitHub raw). `/api/admin/*` and `/api/ingest/*` are
behind Cloudflare Access already. One rule covers both proxies:

**Security → WAF → Rate limiting rules → Create rule → Edit expression**

| Field | Value |
|---|---|
| Rule name | `public-proxies` |
| Expression | `(starts_with(http.request.uri.path, "/img/") or starts_with(http.request.uri.path, "/api/data/")) and not cf.client.bot` |
| Characteristics | IP |
| Period | 10 seconds |
| Requests | **150** |
| Action | Block |
| Duration | 10 seconds |

Why 150 per 10 seconds, from a measured session rather than a template:
opening `/games` fetches `index.json`, 5 shards and roughly 30 thumbnails in
the first couple of seconds, and fast-scrolling the virtualised table adds a
few dozen more. Someone browsing hard stays under ~100 in any 10-second window;
150 leaves headroom for a shared office or CGNAT address that looks like one
client. A scraper pulling faster than 15 requests a second is blocked for 10
seconds, again and again.

Block is tolerable here because the Free plan's timeout is fixed at 10 seconds:
a false positive costs a real visitor ten seconds of missing thumbnails, not a
lockout. `not cf.client.bot` keeps verified search crawlers out of the count.

**Use the WAF rule, not a Worker-side limiter.** The WAF rejects at the edge
*before* the Worker runs, so an abusive burst costs no Worker invocations. A
limiter inside the Worker has already paid for the request by the time it says
no — backwards for cost control.

**Check** (this will get your own IP blocked for 10 seconds, which is the point):

```bash
for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code}\n' https://free-steam-games.win/api/data/data/index.json; done | sort | uniq -c
```

Expected: about 150 × `200`, then `429`s. Watch **Security → Events** for a
week before changing the threshold.

---

## 4. Bot Fight Mode — leave it OFF on this site

It sounds like a free win and here it is not. Cloudflare's own documentation
says two things that decide it:

- it "may challenge API or mobile app traffic", and
- "you cannot bypass or skip Bot Fight Mode using WAF custom rules or Page
  Rules".

This site's most important non-browser clients are exactly that traffic:

- **The desktop and Android apps** fetch `/api/data/*` with plain `fetch()`. A
  challenge answers with an HTML page no app can solve, so the apps would stop
  loading the catalogue — the same symptom the CORS fix just repaired.
- **The discovery workflow** calls `/api/ingest/*` from GitHub Actions, a
  datacenter IP running a script client — the textbook thing it challenges.

Only an IP Access rule takes precedence over it, and GitHub's runner ranges are
far too broad to allowlist sensibly. The rate-limit rule above already covers
the abuse that actually costs money here.

**Managed rules** (Security → WAF → Managed rules): leave on whatever your plan
provides. This site has no form posts and no SQL, so false positives are
unlikely — but if the apps or discovery start failing after a ruleset change,
check **Security → Events** first.

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
