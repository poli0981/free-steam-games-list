# Security setup

What is already enforced in code, and what you still have to switch on in the
Cloudflare dashboard. Every item ends with a command you can run to check it,
because a security setting you believe is on and is not is worse than one you
know is off.

Companion docs: [`ADMIN.md`](ADMIN.md) for Access and the GitHub App,
[`DEPLOYMENT.md`](DEPLOYMENT.md) for the Worker itself.

---

## 1. Response headers — done in code

Three places now, and none inherits from the others:

| File | Covers |
|---|---|
| `web/svelte.config.js` (`kit.csp`) | the Content-Security-Policy on every app page |
| `web/static/_headers` | every other security header on static assets |
| `web/worker/lib/http.ts` | everything the Worker generates (`/api/*`, `/img/*`) |

Add a header that must hold everywhere and you must add it in each.

### Why the CSP moved out of `_headers` (2026-09-12)

SvelteKit emits exactly one inline `<script>` per page — the hydration
bootstrap — and offers no way to avoid it. Under the old header policy's
`script-src 'self'` the browser blocked it, so every page rendered its
prerendered HTML and then sat there completely inert. Measured in a real
browser, on every route:

```
Executing inline script violates the following Content Security Policy
directive 'script-src 'self''
```

`kit.csp` with `mode: "hash"` makes SvelteKit compute that script's sha256 at
build time and emit the whole policy as a `<meta>` tag that already trusts it.

**The header CSP had to go, not just relax.** Browsers enforce the
INTERSECTION of a header policy and a meta policy, so leaving
`script-src 'self'` in `_headers` would have kept blocking the script no matter
what the meta allowed.

One directive is lost in the move: `frame-ancestors` is ignored in a meta CSP.
`X-Frame-Options: DENY` stays in `_headers` and is now load-bearing rather than
belt-and-braces.

Note `web/public/` is `web/static/` since the SvelteKit migration.

### The CSP

```
default-src 'self'; script-src 'self' https://static.cloudflareinsights.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com https://cdn.akamai.steamstatic.com;
font-src 'self'; connect-src 'self' https://cloudflareinsights.com;
worker-src 'self'; manifest-src 'self'; media-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none'
```

No `frame-ancestors`: it is ignored in a meta CSP, and this policy is emitted
as one. `X-Frame-Options: DENY` in `web/static/_headers` is what stops framing
(see the subsection above).

Verified by loading the built app under it and walking `/games`, four chart
pages, `/about`, `/health` and `/activity`.

`/activity` was missing from that walk until 2026-09-12, and it was the one
page with a violation: it rendered commit avatars straight from
`avatars.githubusercontent.com`, which appears in none of this repo's four
CSPs, so every avatar on the page was blocked. A route added after a CSP walk
does not inherit its result — re-walk, or the claim rots.

Two directives are the way they are for measured reasons, not by preference:

- **`style-src` needs `'unsafe-inline'`.** Bits UI positions popovers and
  dialogs with inline `style` attributes, the virtualised table places its rows
  that way, and ECharts sizes its canvas the same way.
  This is the acceptable half of the trade: the app renders no user-supplied
  HTML, and `script-src` stays strict, which is the directive that actually
  stops code execution.
- **`script-src` carries one external host and one hash**, and no
  `'unsafe-inline'`. The host is the Web Analytics beacon (section 9); the
  hash is SvelteKit's own per-page bootstrap. `index.html` also contains an
  inline `<script type="application/ld+json">`, but that is a data block which
  is never executed, so `script-src` does not govern it.

`connect-src` allows `'self'` and the analytics beacon's reporting host, and
nothing else. It notably does **not** allow `https://api.github.com`, which it
used to for one page. Both reasons are gone:

- The Activity page now reads `/api/activity`, a Worker route that fetches the
  commit list server-side, narrows it to the fields the page renders (dropping
  the author email GitHub returns for every commit, and the message body, whose
  `Co-Authored-By` trailers carry real addresses), and rewrites avatar URLs to
  `/img/gh/{u|in}/{id}`. Edge-cached for 5 minutes, which also bounds upstream
  traffic to ~12 calls/hour against GitHub's anonymous budget of 60.
- The Android release check still calls `api.github.com`, but only under
  `isTauri() && isAndroid()`, and the packaged apps use the separate CSP in
  `src-tauri/tauri.conf.json` — not this file.

The two `cloudflareinsights.com` hosts are **web only**, added by the same
`IS_TAURI` ternary: the packaged apps must not phone a beacon, and
`scripts/verify-dist.mjs` fails the Tauri build if either appears in it.

`img-src` correspondingly does **not** list `avatars.githubusercontent.com`.
Avatars are proxied. Widening `img-src` would have been the smaller diff and
the wrong call: it puts a third-party host back in the page and hands every
visitor's IP to GitHub, which the privacy policy says does not happen.

### Why there is no CSP on API responses

They are JSON and images, not documents; a policy would govern nothing. The one
HTML document the Worker *does* serve — the admin app's shell, for `/admin` and
its four sibling routes — carries its own stricter CSP: `default-src 'none'`
and a `script-src` of a per-response nonce and nothing else
(`worker/routes/admin-spa.ts`). `worker/routes/admin-spa.test.ts` checks the
nonce is fresh per response and that `script-src` never gains
`'unsafe-inline'`.

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
Strict Transport Security), not in `web/static/_headers` or the Worker — on
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
`/api/data/*` (proxies GitHub raw). `/admin` (with its API at `/admin/api/*`)
and `/api/ingest/*` are behind Cloudflare Access already. One rule covers both proxies:

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

## 4. Bots and countries — one switch to leave off, two rules to add

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

### The human check that IS safe here

What Bot Fight Mode cannot be — scoped — a WAF **custom rule** can. Custom
rules are a separate quota from the single rate-limiting rule above (the Free
plan allows five), and a Managed Challenge from one of them can be aimed at
page loads only:

**Security → WAF → Custom rules → Create rule**

| Field | Value |
|---|---|
| Rule name | `human-check-pages` |
| Expression | `not starts_with(http.request.uri.path, "/api/") and not starts_with(http.request.uri.path, "/img/") and not starts_with(http.request.uri.path, "/_app/") and not starts_with(http.request.uri.path, "/.well-known/") and not cf.client.bot and cf.threat_score > 14` |
| Action | Managed Challenge |

Every exclusion is load-bearing, and each one is a thing that breaks without
it:

- `/api/` — the packaged apps' catalogue fetch and the GitHub Actions ingest
  call. An HTML challenge page is not something either can solve; this is the
  exact failure Bot Fight Mode would cause, reintroduced by hand.
- `/img/` — artwork, requested by the apps cross-origin.
- `/_app/` — hashed bundles. Challenging a module request breaks hydration on
  a page that already passed the check.
- `/.well-known/` — `security.txt` exists to be read by scanners.
- `not cf.client.bot` — verified crawlers. Challenge Googlebot and the site
  leaves the index.

`cf.threat_score` narrows it further, so an ordinary visitor never sees the
interstitial. Drop that condition to challenge every page load, and expect
complaints. Watch **Security → Events** for a week either way.

`docs/PRIVACY_POLICY.md` describes this check to visitors; it is a third party
interrupting their page load, so it belongs there.

### Blocking countries

Second custom rule, and the actual boundary for the country restriction:

| Field | Value |
|---|---|
| Rule name | `blocked-countries` |
| Expression | `ip.geoip.country in {"CN" "RU" "AR"}` |
| Action | Block |

`"CN"` is mainland China only — Hong Kong, Macau and Taiwan are `HK`, `MO` and
`TW` and are not matched.

**This rule, not the Worker, is what blocks the site.** `BLOCKED_COUNTRIES` in
`web/wrangler.jsonc` makes the Worker refuse the same countries
(`worker/lib/geo.ts`), but the Worker only ever sees the four
`assets.run_worker_first` prefixes — the prerendered HTML is served by the
static-asset server without invoking it. Someone in a blocked country would
read every page and only find the catalogue missing. Keep both: the var is
reviewable in Git and holds if the rule is ever deleted or mis-scoped, and the
rule is what actually covers the site.

Know what this costs before turning it on:

- **Yandex indexing ends.** Its crawler is in RU, and `ip.geoip.country` is
  evaluated before `cf.client.bot` matters to a Block action.
- **The desktop and Android apps stop working** in those countries, updater
  feed included — they fetch the same `/api/*` paths.
- **VPNs evade it trivially.** This is a posture, not a security control.
- **Tor exits report as `T1`**, which is not a country code and is not
  matched; `worker/lib/geo.ts` also refuses to treat `XX` (unknown) as one, so
  adding it to the var cannot accidentally block everyone the edge failed to
  place.

**Check — and read this before trying, because the obvious check does not
work.** Sending `-H 'CF-IPCountry: CN'` to production proves nothing:
`worker/lib/geo.ts` reads `request.cf.country` first, which comes from the real
client IP and cannot be spoofed, and Cloudflare overwrites that header on
ingress anyway. The header fallback exists only for environments that have no
`request.cf` at all.

So there are two honest checks:

- **The WAF rule**: from a real address in one of those countries, or from
  **Security → Events**, which is where a Block shows up.
- **The Worker's own refusal**, locally: `wrangler dev` supplies its own
  `request.cf` (measured: `country: "SG"`), so temporarily add that country to
  `BLOCKED_COUNTRIES`, restart, and watch every Worker route refuse:

  ```bash
  for p in /api/activity /api/data/data/index.json /img/t/730/header.jpg /admin /; do
    printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8790$p)"
  done
  ```

  Expected: `403` four times — **and `/` still `200`**, because a static asset
  never invokes the Worker. That last line is the whole reason the WAF rule
  cannot be skipped. Put the real list back afterwards.

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

- `/admin` (the SPA and its API at `/admin/api/*`, one application) and
  `/api/ingest/*` are Access-gated, with **AUDs scoped per route** so the unattended discovery token cannot reach the admin
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
  `PRIVACY_POLICY.md` promises. The country block in section 4 reads
  `request.cf.country` per request and stores nothing: no row, no log, no
  counter.
- Commits made from `/admin` say "by admin", not the reviewer's Access address,
  and `data/overrides/*.json` records `"set_by": "admin"` for the same reason —
  those files are public forever. Who did what stays in D1
  (`shared/admin-api.ts`, `ADMIN_ATTRIBUTION`).

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

## 9. Web Analytics — the JS snippet, never the automatic setup

Automatic injection was on from before 2026-09-12 and **never collected a
single page view**. Every load logged two CSP violations instead:

```
Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/...'
violates the following Content Security Policy directive: "script-src 'self'"
Executing inline script violates ... 'script-src 'self''
```

The tag was not in the repository — `curl` of the deployed HTML showed none.
Cloudflare injects the beacon **plus an inline loader** into HTML responses at
the edge, after the origin response and therefore after our CSP.

**That mode can never work here, and this is the part worth remembering.** The
site's CSP runs in `mode: "hash"` (SvelteKit hashes its own bootstrap script),
and CSP3 says a `script-src` carrying a hash or nonce **ignores
`'unsafe-inline'`**. There is no policy that admits an inline script we cannot
hash, and we cannot hash one the edge writes after we have built the page. The
only fix available is not to use that mode.

**What is configured now:**

1. **Analytics & Logs → Web Analytics → Manage site → "Enable with JS Snippet
   installation".** This stops the edge injection. "Enable, excluding visitor
   data in the EU" is fine to keep alongside it.
2. Copy the site token into `CF_BEACON_TOKEN` in `web/src/lib/analytics.ts`.
   It is not a secret — Cloudflare's own snippet publishes it in the page — and
   an empty value simply disables analytics, which is what a fork gets.
3. The app appends the beacon itself, from the `$effect` in
   `routes/+layout.svelte` that already waits on `consent.accepted`, so nothing
   loads before the reader accepts the terms, and never under Tauri.
4. `svelte.config.js` allows `https://static.cloudflareinsights.com` in
   `script-src` and `https://cloudflareinsights.com` in `connect-src`, **web
   flavour only**. `scripts/verify-dist.mjs` fails the build if either is
   missing from the web build or present in the Tauri build.

`docs/PRIVACY_POLICY.md` was rewritten for this: it used to say the site had no
analytics and contacted no third party, which is what made the "just allowlist
it" option unacceptable before.

**Check** (in a browser console, not curl — the injection was
browser-conditional and the app's own load is consent-conditional):

open <https://free-steam-games.win/>, accept the terms, and confirm a single
request to `static.cloudflareinsights.com` with **no** CSP error. Before
accepting there must be none at all.

---

## 10. Hotlink Protection is ON, and the packaged apps survive it by luck

Found 2026-09-12 while running the SvelteKit dev server, which proxies `/img/*`
to production: every image came back **403**, body `error code: 1011` —
Cloudflare's Hotlink Protection.

It keys on `Referer`. Measured against the live zone:

| Referer sent | `/img/*` |
|---|---|
| none | 200 |
| `https://free-steam-games.win/` | 200 |
| `http://localhost:5173/` | **403** |
| `tauri://localhost/` | **403** |
| `http://tauri.localhost/` | **403** |

`/api/data/*` is unaffected — the rule only covers images.

**Why this matters beyond dev.** The desktop and Android builds load `/img/*`
from `tauri://localhost` and `http://tauri.localhost`. Both of those Referers
are blocked. Images render in the shipped apps **only because the Tauri webview
currently sends no Referer at all for `<img>` requests.** That is not a
guarantee anybody made: sending a Referer is the ordinary, spec-compliant
behaviour, so a WebView2 or Android System WebView update could start doing it
and blank every image in both apps, with no change on our side and nothing in
the repo to explain why.

**Recommended: turn Hotlink Protection OFF** (dashboard → Scrape Shield →
Hotlink Protection). It buys nothing here and costs the above:

- It is not what restricts `/img/*`. That is the anchored `PATH_RE` and the
  two-host `SOURCE_HOSTS` allowlist in `worker/routes/img.ts`, which no client
  header can influence.
- `Referer` is set by the client and trivially forged, so as an access control
  it is theatre; as an availability dependency for the packaged apps it is
  real.
- The images are Steam's own store art, already served publicly by Valve's CDN
  to anyone. There is nothing here that hotlinking would steal.

There is no allowlist workaround: Cloudflare's allowed-domain list takes
hostnames, and `tauri://localhost` is a custom scheme it cannot express.

**Check** (the bare request must be 200 and the localhost one must also be 200
once this is off):

```bash
curl -s -o /dev/null -w '%{http_code}
' -H "Referer: http://localhost:5173/" "https://free-steam-games.win/img/t/730/header.jpg?t=1749053861"
```

Until it is switched off, `npm run dev` shows broken thumbnails. The data,
charts and everything else work; only images are affected.

---

## 11. Continuous script monitoring adds a report-only CSP to some responses

Found 2026-09-17 in the browser console on the live site, on roughly one page
load in thirty:

```
[Report Only] Refused to ... because it violates the following Content Security
Policy directive ... report-uri /cdn-cgi/script_monitor/report
```

It is not in the repository. Cloudflare's **Continuous script monitoring**
(Page Shield) samples responses at the edge and adds a
`Content-Security-Policy-Report-Only` header whose reports go to
`/cdn-cgi/script_monitor/report`. Report-only means it blocks nothing, so the
site works; the cost is console noise, and that the reports send page and
script URLs from visitors' browsers to Cloudflare, which
`docs/PRIVACY_POLICY.md` does not mention.

It also adds nothing this site needs: every script is first-party, the app's
own CSP already refuses anything else, and the admin shell's nonce policy is
stricter still.

**Recommended: turn it OFF** (dashboard → Security → Settings → Continuous
script monitoring). Dashboard action, so it is the maintainer's to do. If it is
ever wanted on, say so in the privacy policy first.

**Check** (repeat a few times; the header is sampled):

```bash
for i in 1 2 3 4 5 6 7 8; do curl -sI https://free-steam-games.win/ | grep -ci "content-security-policy-report-only"; done
```

Every line must print `0`.

---

## Still open

Nothing from this list. `audit_log` and `commit_jobs` are pruned daily after
`ADMIN_RETENTION_DAYS` (180), which `docs/PRIVACY_POLICY.md` states.
