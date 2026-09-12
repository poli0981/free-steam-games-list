# PRIVACY POLICY

**Applies to:** the website at <https://free-steam-games.win>, the repository at
<https://github.com/poli0981/free-steam-games-list>, and the desktop / Android
app built from it.

**Last substantive change:** September 2026, when the site moved from GitHub
Pages to Cloudflare and sign-in was removed. See git history for the exact diff.

---

## Short version

The site does not ask who you are. There are no accounts, no sign-in, no
analytics, no advertising, and no tracking cookies.

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

The maintainer does not run any additional logging, does not have
Cloudflare Web Analytics enabled, and does not export logs anywhere.

**No cookies are set by this site.** Cloudflare may set its own operational
cookies for security purposes; those are Cloudflare's, not the site's.

## What the page loads

Everything the site loads is fetched **same-origin**, through the site itself:

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
and User-Agent. **That exception is gone.** No page on the website contacts a
third party any more.

### The one remaining exception, stated plainly

**The desktop and Android apps** check the GitHub Releases API on launch to see
whether an update exists. That request goes to GitHub from the app, so GitHub
sees the IP address it comes from. It happens once per session, sends nothing
about you beyond what any HTTP request carries, and has no equivalent on the
website — the website uses its service worker instead.

GitHub's handling is covered by the
[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement).

## What is stored on your device

All of it stays on your device. None of it is transmitted anywhere.

| Where | Key | Why |
|---|---|---|
| localStorage | `f2p:legal_consent` | that you accepted the terms, and which version |
| localStorage | `f2p:welcome_seen` | that you have seen the introduction |
| localStorage | `f2p:theme` | light / dark / system |
| localStorage | `f2p:lang` | interface language |
| sessionStorage | `f2p:chunk-reload` | one-shot flag so a failed script load retries once |
| IndexedDB | `f2p:records`, `f2p:index` | the catalogue, cached so the site works offline and does not re-download ~6 MB each visit |
| Cache Storage | `workbox-precache-*`, `f2p-data-v3`, `f2p-img-v1` | the offline app shell, data and images |

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

## What is not collected

No accounts. No analytics or telemetry of any kind. No advertising or
behavioural profiles. No fingerprinting. No session recording. No email list.
No sale or sharing of anything, because there is nothing to sell or share.

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

This file is versioned in git. Material changes bump `TERMS_VERSION` in the
app, which re-prompts everyone at the consent gate rather than quietly
substituting new terms.
