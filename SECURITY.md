# Security policy

## What this project actually is

The previous version of this file said the repository was "just a Markdown
list… no executable code, no dependencies, no backend, no user data." That was
wrong on every count, so here is the real picture:

- a **Cloudflare Worker** serving the site, holding a D1 binding and — for the
  admin path — a credential that can write to this repository
- a **React single-page app** with a few dozen npm dependencies
- a **Tauri 2 desktop and Android app**, signed, with an auto-updater
Operational hardening — headers, HSTS, rate limiting, WAF — is documented in
[`docs/SECURITY_SETUP.md`](docs/SECURITY_SETUP.md), with a check command for
each item.

- a **Python pipeline** run by 23 GitHub Actions workflows, several holding
  secrets that can push to `main`

There is genuinely something to attack here. Hence a real policy.

## Reporting

**Use GitHub's private vulnerability reporting**, which is enabled on this
repository: *Security → Report a vulnerability*. It is private between you and
the maintainer.

If that does not work for you, email **contact@poli0981.dev**. The same
address is published in [`AUTHORS.md`](AUTHORS.md),
[`docs/Contact.md`](docs/Contact.md), [`username.txt`](username.txt) and
<https://free-steam-games.win/.well-known/security.txt>.

That `security.txt` is the machine-readable version of this policy
(RFC 9116). Its `Policy` field points back at this file and its `Canonical`
field at itself; if the two ever disagree, **this file wins** and the
`security.txt` is stale.

**Please do not open a public issue for anything exploitable.** Public issues
are fine for a dead link or a game that is no longer free — those are data
problems, not security ones.

Useful report: what you did, what happened, why it matters, and how to
reproduce. A proof-of-concept URL beats a paragraph of description.

## In scope

- The Cloudflare Worker (`web/worker/**`) — the data proxy, the image proxy,
  and anything reachable under `/api/*`
- The `/admin` path and its Cloudflare Access gate
- The D1 database and anything that writes to it
- The GitHub Actions workflows, especially any path where untrusted input
  reaches a step that can push to `main`
- The Tauri updater and its signing key
- Dependency vulnerabilities that are actually reachable from shipped code

Things worth probing specifically: making `/img/*` fetch an origin that is not
`shared.akamai.steamstatic.com` or `shared.fastly.steamstatic.com`; making
`/api/data/*` return a path outside its allowlist; reaching admin
functionality without an Access session.

## Out of scope

- Games in the list being bad, predatory, or full of microtransactions. Take it
  up with the developer.
- Anything about Valve or Steam itself.
- Missing security headers with no demonstrated impact, and scanner output
  pasted without a working exploit.
- Denial of service by volume.
- Social engineering of the maintainer.

## What to expect

One person, as a hobby, in a timezone that is probably not yours. A first reply
usually within a week. Serious issues get fixed before they are discussed
publicly; minor ones may sit for a while.

No bounty programme, no money — the disclaimers about the maintainer being
broke are not a joke. Credit in `docs/ACKNOWLEDGEMENTs.md` if you want it.

## Supported versions

The deployed site and `main` are the only supported versions. Desktop and
Android releases are supported at the latest tag only; there are no backports.
