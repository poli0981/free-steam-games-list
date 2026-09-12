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
font-src 'self'; connect-src 'self'; worker-src 'self';
manifest-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'
```

Verified by loading the built app under it and walking `/games`, four chart
pages, `/about`, `/health` and `/activity`.

`/activity` was missing from that walk until 2026-09-12, and it was the one
page with a violation: it rendered commit avatars straight from
`avatars.githubusercontent.com`, which appears in none of this repo's four
CSPs, so every avatar on the page was blocked. A route added after a CSP walk
does not inherit its result — re-walk, or the claim rots.

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

`connect-src` is `'self'` with no exceptions, as of 2026-09-12. It used to
allow `https://api.github.com` for one page. Both reasons are gone:

- The Activity page now reads `/api/activity`, a Worker route that fetches the
  commit list server-side, narrows it to the fields the page renders (dropping
  the author email GitHub returns for every commit, and the message body, whose
  `Co-Authored-By` trailers carry real addresses), and rewrites avatar URLs to
  `/img/gh/{u|in}/{id}`. Edge-cached for 5 minutes, which also bounds upstream
  traffic to ~12 calls/hour against GitHub's anonymous budget of 60.
- The Android release check still calls `api.github.com`, but only under
  `isTauri() && isAndroid()`, and the packaged apps use the separate CSP in
  `src-tauri/tauri.conf.json` — not this file.

`img-src` correspondingly does **not** list `avatars.githubusercontent.com`.
Avatars are proxied. Widening `img-src` would have been the smaller diff and
the wrong call: it puts a third-party host back in the page and hands every
visitor's IP to GitHub, which the privacy policy says does not happen.

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

### Decided 2026-09-12: submit for preloading

Of the two options this section used to leave open — submit it yourself, or
remove the `preload` directive so nobody else can — the maintainer chose to
submit. Rationale: the directive is already in the header, so the invitation is
already open to third parties; submitting deliberately is strictly better than
leaving it for someone else to do on a schedule you do not control.

**Eligibility was verified before the decision, and there are no blockers:**

```bash
curl -s "https://hstspreload.org/api/v2/preloadable?domain=free-steam-games.win"
```

returned `{"errors": [], "warnings": []}` — a clean pass. Port 80 also 301s to
HTTPS, which is one of the criteria. So all four requirements hold: valid
certificate, HTTP → HTTPS redirect, `max-age` of at least 31536000 with
`includeSubDomains` and `preload`, and every subdomain HTTPS-only.

**This step is the maintainer's to perform, and it is not reversible on any
useful timescale.** Submission at <https://hstspreload.org> bakes HTTPS-only
for `free-steam-games.win` *and every subdomain* into shipped browser binaries.
Removal requires a separate request plus the months it takes for browser
releases to roll over. Do not submit until you are certain no subdomain will
ever need plain HTTP.

**Check the header, then the list status:**

```bash
curl -sI https://free-steam-games.win/ | grep -i strict-transport
```

```bash
curl -s "https://hstspreload.org/api/v2/status?domain=free-steam-games.win"
```

`"status": "unknown"` means not submitted. After a successful submission it
becomes `"pending"`, and `"preloaded"` once it ships in a browser release.

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

## 8. security.txt — and the one date that will rot

`web/public/.well-known/security.txt` (RFC 9116) points researchers at GitHub's
private vulnerability reporting first and `contact@poli0981.dev` second.

It is a plain static file. `/.well-known/*` is **not** in `wrangler.jsonc`'s
`run_worker_first`, so it never invokes the Worker, and Cloudflare's asset
server infers `text/plain` from the extension. It has to exist as a real file:
`not_found_handling` is `"single-page-application"`, so before it was added a
request for it returned `dist/index.html` with **HTTP 200** — scanners got a
web page and no error.

**Recurring task: renew `Expires` before 2027-09-01.** RFC 9116 requires the
field and scanners treat an expired file as no file at all. Bump the date and
redeploy; there is nothing else to do.

**Check:**

```bash
curl -s https://free-steam-games.win/.well-known/security.txt
```

Must return the field list as `text/plain`, not the SPA shell.

---

## 9. Cloudflare Web Analytics is injecting a script the CSP blocks

Found 2026-09-12 by reading the browser console on the live site, not from any
report. Every page load logs two CSP violations:

```
Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/...'
violates the following Content Security Policy directive: "script-src 'self'"
Executing inline script violates ... 'script-src 'self''
```

It is not in the repository — `curl` of the deployed HTML shows no such tag.
Cloudflare **Web Analytics** is enabled on the zone with automatic setup, and
injects the beacon plus an inline loader into HTML responses at the edge, after
the origin response and therefore after our CSP.

So the beacon has never actually run: the analytics are empty and the only
effect is two console errors per page load.

**Recommended: turn Web Analytics OFF** (dashboard → Analytics & Logs → Web
Analytics). It is a third-party tracking beacon, and
`docs/PRIVACY_POLICY.md` tells visitors the site loads no third-party
resources and collects nothing. Allowlisting `static.cloudflareinsights.com`
in `script-src`/`connect-src` is the other option, but it would make that
promise false and require rewriting the privacy policy.

Dashboard action, so it is the maintainer's to do.

**Check** (in a browser console, not curl — the injection is
browser-conditional):

open <https://free-steam-games.win/> and confirm no `cloudflareinsights`
error appears.

---

## Still open

`audit_log` has no pruning job. It grows only with admin actions so it is not
urgent, but it is unbounded — pick a retention window and make it agree with
`docs/PRIVACY_POLICY.md` before it matters.
