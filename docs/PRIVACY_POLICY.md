# PRIVACY POLICY

**Applies to:** the website at <https://free-steam-games.win>, the repository at
<https://github.com/poli0981/free-steam-games-list>, and the desktop / Android
app built from it.

**Last substantive change:** September 2026 — the website now asks each browser
to pass a Cloudflare Turnstile check, at most once a day, after you accept these
terms. Earlier the same month Cloudflare Web Analytics was
switched on, a human-verification challenge was added for suspicious traffic,
and the site became unavailable in three countries. Each is described below.
See git history for the exact diff; the app now shows you that diff at the
consent gate rather than asking you to re-read everything.

---

## Short version

The site does not ask who you are. There are no accounts, no sign-in, no
advertising, no tracking cookies and no profile of you anywhere.

There is now one analytics measurement — Cloudflare Web Analytics — which is
cookieless, records no identifier for you, and does not load at all until you
have accepted these terms. The website contacts two third parties, both only
after you accept: that measurement, and Cloudflare Turnstile, which checks that
you are a person rather than a bot (described below).

It is not, however, "serverless" any more, and the previous version of this
document said things that are no longer true. The site is now served by a
Cloudflare Worker, which means a server does sit between you and the page, and
that server keeps operational logs. This document says exactly what that
involves.

## What runs the site

**Cloudflare** serves every request. Like any CDN or web server, Cloudflare
processes your IP address, User-Agent and the URL you asked for in order to
deliver the page, and retains operational and security logs under its own
policy. Cloudflare acts as a processor for the site; see the
[Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/).

The maintainer runs no additional logging of their own and exports logs
nowhere.

**No cookies are set by this site.** Cloudflare may set its own operational
cookies for security purposes — including when it shows you the verification
steps described below; those are Cloudflare's, not the site's.

### Cloudflare Web Analytics

The website loads Cloudflare's analytics beacon
(`static.cloudflareinsights.com`) once you have accepted these terms, and it
reports page views and page-load timings to `cloudflareinsights.com`.

What that means in practice, from Cloudflare's own description of the product:
it sets **no cookie**, stores **no identifier** in your browser, does **not**
fingerprint you, and does not follow you to any other site. It counts visits;
it does not build a profile. Visitors in the EU are excluded from it entirely
by a setting on the account.

Three things follow, and they are the reason it is acceptable here:

- It does not run before you accept. Declining, or simply not accepting, means
  the script is never loaded — the same rule that already holds back the
  catalogue download and the service worker.
- It does not run in the desktop or Android apps at all.
- You can stop it at any time with any content blocker, and nothing on the site
  breaks if you do.

### Verifying that you are not a bot

Cloudflare may interrupt a page load with its own verification step — a
"checking your browser" interstitial — when a request looks automated. This is
a Cloudflare feature configured on the account, not code in this site, and it
is deliberately scoped to page loads: the catalogue API, the image proxy and
the packaged apps are excluded from it so they keep working. Whether it appears
is Cloudflare's judgement, based on the request itself. See the
[Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/) for what
that check processes.

### The Turnstile check on the website

After you accept these terms, the website asks your browser to pass Cloudflare
Turnstile before it loads the catalogue, and again at most once every 24 hours.
Unlike the interstitial above, this one is code in this site, and it runs for
every visitor, not only for requests that look automated.

- The widget is loaded from `challenges.cloudflare.com`. To tell a person from
  a bot it examines your IP address, your browser's User-Agent and TLS
  fingerprint, and signals about how the page is being run. Cloudflare
  processes these on the site's behalf, and is itself the controller of them
  where it uses them to improve its bot detection; see the
  [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).
- The widget hands your browser a one-time token. The site's Worker sends that
  token and your IP address to Cloudflare to confirm it, and keeps neither.
- Your browser then remembers when the check expires (`f2p:human_check`,
  below), so it is not repeated for 24 hours.
- It does not run before you accept, and not at all in the desktop or Android
  apps. The catalogue API and the image proxy never require it.
- If something blocks `challenges.cloudflare.com`, the website cannot complete
  the check for you; the apps and the repository work without it.

### Where the site is available

The site is not served to visitors in **mainland China, Russia or Argentina**.
That decision is enforced at Cloudflare's edge, which means your IP address is
matched against Cloudflare's own geolocation before anything else happens; the
site stores nothing about it and keeps no record of refused requests. Hong
Kong, Macau and Taiwan are not affected. The maintainer may change this list at
any time.

## What the page loads

Apart from the analytics beacon and the Turnstile check above, everything the site loads is fetched
**same-origin**, through the site itself:

- `/api/data/*` — the catalogue. The Worker fetches these files from GitHub on
  the server side, so your browser never contacts GitHub for them and GitHub
  does not see your IP.
- `/img/*` — game artwork. The Worker fetches it from Valve's CDN on the server
  side, so Valve does not see your IP either.
- `/api/activity` — the recent-commits list on the Activity page, and the
  contributor avatars shown beside each entry. Same arrangement: the Worker
  calls GitHub server-side and proxies the avatars, so your browser never
  contacts GitHub.

That is a deliberate change: previously your browser fetched data from GitHub
and images from Valve's CDN and a third-party image proxy directly.

Until September 2026 the Activity page was an exception to all of this: it
called the GitHub API from your browser and loaded avatars from
`avatars.githubusercontent.com`, so opening it showed GitHub your IP address
and User-Agent. **That exception is gone**, and no page contacts GitHub from
your browser. The analytics beacon and the Turnstile check are now the only
third parties any page contacts, and only after you accept.

### The one remaining exception, stated plainly

**The desktop and Android apps** check for a newer version once per session,
after you have accepted the terms:

- The **desktop app** asks free-steam-games.win, and only if an update exists
  and you choose to install it does it download the installer from GitHub
  Releases, so GitHub sees the IP address that download comes from.
- The **Android app** asks the GitHub Releases API directly, so GitHub sees the
  IP address of that check.

Neither sends anything about you beyond what any HTTP request carries, and
neither has an equivalent on the website — the website uses its service worker
instead.

GitHub's handling is covered by the
[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).

## What is stored on your device

All of it stays on your device. None of it is transmitted anywhere.

| Where | Key | Why |
|---|---|---|
| localStorage | `f2p:legal_consent` | that you accepted the terms, and which version of each document |
| localStorage | `f2p:legal_snapshot` | a copy of the documents you accepted, so a later change can be shown to you as a comparison instead of a second full read |
| localStorage | `f2p:welcome_seen` | that you have seen the introduction |
| localStorage | `f2p:human_check` | when your last Turnstile check expires, so it is not repeated for 24 hours (website only) |
| localStorage | `f2p:theme` | light / dark / system |
| localStorage | `f2p:lang` | interface language |
| sessionStorage | `f2p:chunk-reload` | one-shot flag so a failed script load retries once |
| IndexedDB | `f2p:records`, `f2p:index` | the catalogue, cached so the site works offline and does not re-download ~6 MB each visit |
| Cache Storage | `workbox-precache-*`, `f2p-img-v1` | the offline app shell and images (website only) |

The website's service worker used to keep a second copy of the catalogue in
Cache Storage as `f2p-data-v3`. It no longer does, and the site deletes that
cache from your browser the next time it loads.

Clearing site data in your browser removes all of it. Doing so re-shows the
consent gate and the introduction, and the catalogue downloads again.

## The admin area

An admin area exists at `/admin`, gated by Cloudflare Access. It is for the
maintainer. If you are not signed in through Access it returns 404 and sets
nothing.

When the maintainer signs in there, Cloudflare Access sets a `CF_Authorization`
cookie **on that session only**, and administrative actions are recorded in a
Cloudflare D1 database — what was changed, when, and by which Access identity.
That log exists so a bad change can be traced. It records no visitor data,
because visitors never reach it.

Entries in that log, and the record of repository commits made from the admin
area, are deleted automatically after 180 days.

## What is not collected

No accounts. No advertising or behavioural profiles. No fingerprinting by the
site itself (the Turnstile check above is Cloudflare's, and says what it reads).
No session recording. No email list. No sale or sharing of anything, because
there is nothing to sell or share.

Analytics is limited to the cookieless page-view count described above, and to
nothing else: no events, no scroll or click tracking, no error telemetry, and
nothing that could identify you or a single session.

Sign-in was removed entirely in September 2026. The site previously stored a
GitHub access token and an encrypted signing key in your browser; it no longer
has any mechanism to do so. If you used the old version, clearing site data
removes any leftovers.

## Your rights

Since the site holds no personal data about you, there is nothing to export or
delete on this end — clearing your browser storage is the complete picture.

For the operational logs Cloudflare keeps as processor, requests go to
Cloudflare under their policy. If you want to raise something directly, the
contact address is **contact@poli0981.dev** (also in
[docs/Contact.md](./Contact.md)). The maintainer is one
person running this as a hobby, so expect a slow, human reply rather than a
formal privacy desk.

## Children

The site is a catalogue of games and is not directed at children. It collects
nothing from anyone, of any age.

## Changes

This file is versioned in git, and the app hashes each binding document at
build time. When one of them changes, the consent gate reopens by itself and
shows you **only the documents that changed, with the changes marked**, rather
than quietly substituting new terms or asking you to read all six again.

The comparison is made against a copy kept in your own browser
(`f2p:legal_snapshot`). Clearing your site data removes it, in which case the
gate links you to the full document instead.
