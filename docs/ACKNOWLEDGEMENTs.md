# ACKNOWLEDGEMENTS

Big thanks to everyone and everything that made this chaotic repo possible.

### People & Platforms

- **Valve / Steam** — for existing and having a ton of free-to-play games that keep broke people like the maintainer entertained. The Steam logo, store, community, VAC, and all related marks are trademarks of Valve Corporation; this project is independent and not affiliated.
- **GitHub** — for free hosting (data, Pages, Actions, Releases), free CI for the Python pipeline + the web app deploy + the desktop release matrix builds, and for letting unemployed devs pretend they're productive.
- **The Steam community & various review aggregators** — for reviews, tags, and metadata that the pipeline scrapes off public store pages. Where copy-paste happens it stays attributed.
- **Caffeine & instant noodles** — the real MVPs keeping the maintainer awake during update sessions.

### AI assistance (the elephant in the repo)

About 70 % of the code in this repo was generated, refactored, or rubber-ducked with the help of LLM assistants. Code is reviewed and tested before each commit, but mistakes happen — see the four caveats in [`DISCLAIMER.md`](./DISCLAIMER.md) and the GPG-signing fixes in v3.0's CHANGELOG (we shipped two wrong commit-bytes formats before getting it right).

| Era | Who | What it touched |
| --- | --- | --- |
| v1 (2025) | **Grok** (xAI) | Initial Python pipeline scaffolding, ingest workflow, daily-update Action, README v1. |
| v2 (2026 Q1) | **Claude** (Anthropic) | Modular refactor under `scripts/core/`, schema v2.1 + v2.2, the HTML scraper, the health checker, performance work. |
| v3.0 web app + desktop (2026 Q2) | **Claude** | The entire `web/` SPA across phases 1 → 7, the GPG signing pipeline (and its three follow-up fixes), the optimistic-cache layer, the Tauri 2 desktop scaffold + release workflow, the refreshed legal docs, and this CHANGELOG entry. |

No user data is sent to any LLM at runtime. The AI calls happen on the maintainer's dev machine while writing code, never from a visitor's browser.

### Third-party dependencies

The Python pipeline relies on two libraries:

- [`requests`](https://github.com/psf/requests) — Apache-2.0
- [`urllib3`](https://github.com/urllib3/urllib3) — MIT

The web app + desktop wrapper depend on a longer list, all linked with their licences in the in-app **About → Stack & third-party** section. The headline ones:

- React, Vite, TypeScript, Tailwind CSS, shadcn/ui (Radix) — UI runtime, build, types, styling.
- TanStack Query / Table / Virtual — data fetching + 1.2k-row virtualised table.
- Apache ECharts + `echarts-wordcloud` — charts.
- OpenPGP.js — client-side commit signing.
- Workbox + `vite-plugin-pwa` — PWA service worker + offline cache.
- Tauri 2 + `tauri-plugin-shell` — native desktop wrapper.
- `react-i18next` + `i18next-browser-languagedetector` — translations.
- Zustand, Fuse.js, cmdk, lucide-react, sonner, idb-keyval — small but everywhere.

Full SPDX list with deep links to each project's `LICENSE` file lives at `/about` inside the web app, kept up-to-date alongside the dep list itself.

### Maintainer

- **poli0981 / SkullMute** — the unemployed Vietnamese maintainer. ~30 % effort: occasionally opens Steam, scrolls the F2P section, queues new entries, plays on Easy to "verify" (verification level: noob / 10). Sometimes forgets for weeks. The other ~70 % is the AI assistants above plus the daily GitHub Actions cron doing data-refresh work while the maintainer sleeps.

### Tools

- IDE: whichever opens fastest with the darkest theme. VS Code most of the time.
- Other "tools": boredom, procrastination, sale addiction, and the eternal "hôm nay chơi free cái gì đây?".
- Steam library of 400+ games (80 % bought on sale under $10) for "research purposes".

### Contributing

Contributions welcome — see [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the issue templates under [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/). If you add a game, big thanks. If not, that's fine — the maintainer is used to zero social interaction anyway.

This repo is a solo-ish project powered by human laziness + AI assistance + GitHub free tier. Peace out ✨
