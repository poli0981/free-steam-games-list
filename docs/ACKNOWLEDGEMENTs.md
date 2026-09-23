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

**Hosted services the website loads at runtime** — the only code in this
project that comes from someone else's server rather than from the bundle:

- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) — a
  cookieless page-view count, loaded from `static.cloudflareinsights.com`
  **only after the visitor accepts the terms**, and never in the desktop or
  Android apps. `docs/PRIVACY_POLICY.md` describes exactly what it does;
  `web/src/lib/analytics.ts` is the ten lines that load it.
- [Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/) —
  the human check, loaded from `challenges.cloudflare.com` **only after the
  visitor accepts the terms**, at most once a day, and never in the desktop or
  Android apps. `docs/PRIVACY_POLICY.md` describes what it processes;
  `web/src/lib/turnstile.ts` loads it and `web/worker/routes/human-check.ts`
  verifies its token.

Everything below ships inside the bundle.

The Python pipeline relies on two libraries:

- [`requests`](https://github.com/psf/requests) — Apache-2.0
- [`urllib3`](https://github.com/urllib3/urllib3) — MIT

The web app and the desktop/Android wrapper depend on a longer list. The
in-app **About → Stack & third-party** section shows the headline ones with
links and licences; this is the whole list, grouped by what it does.

**Framework & build**
- [Svelte 5](https://svelte.dev/) + [SvelteKit 2](https://svelte.dev/docs/kit) — UI runtime and app framework, with `adapter-static` (all MIT).
- [TypeScript 6](https://www.typescriptlang.org/) — type system (Apache-2.0).
- [Vite 8](https://vitejs.dev/), powered by the [Rolldown](https://rolldown.rs/) bundler, and `@sveltejs/vite-plugin-svelte` (MIT).
- [Tailwind CSS 4](https://tailwindcss.com/) via `@tailwindcss/vite` (MIT). Tailwind 4 is a Vite plugin, so there is no PostCSS step and no `tailwind.config.ts`.

**Styling helpers**
- [tailwind-merge](https://github.com/dcastil/tailwind-merge) — class merging (MIT).
- [clsx](https://github.com/lukeed/clsx) — conditional class join (MIT).
- [class-variance-authority](https://cva.style/) — variant API (Apache-2.0).

**UI**
- [Bits UI](https://bits-ui.com/) — headless dialog/popover/select primitives for Svelte (MIT).
- [`@lucide/svelte`](https://lucide.dev/) — icons (ISC).
- [svelte-sonner](https://svelte-sonner.vercel.app/) — toasts (MIT).
- [`@tanstack/svelte-virtual`](https://tanstack.com/virtual) — the virtualised game table (MIT).

**Data**
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) — IndexedDB wrapper for the offline catalogue (Apache-2.0).
- [Fuse.js](https://www.fusejs.io/) — fuzzy search (Apache-2.0).

**Charts**
- [Apache ECharts 6](https://echarts.apache.org/) (Apache-2.0).
- [echarts-wordcloud](https://github.com/ecomfe/echarts-wordcloud) — wordcloud series (ISC). Its peer range still names echarts 5; `package.json` carries an `overrides` entry rather than pinning echarts back.

**Legal documents**
- [unified](https://unifiedjs.com/) with remark-parse, remark-gfm, remark-rehype, rehype-sanitize, rehype-slug and rehype-stringify — markdown to HTML (all MIT). These run at BUILD time only, so no parser or sanitizer reaches the browser.

**Offline**
- [Workbox](https://developer.chrome.com/docs/workbox) via [`@vite-pwa/sveltekit`](https://vite-pwa-org.netlify.app/) — service worker and precache (MIT). Web only: the packaged apps never register one.

**Typefaces**
- [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), [IBM Plex Sans](https://github.com/IBM/plex) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), self-hosted through `@fontsource-variable` (all OFL-1.1).

**Desktop and Android (Tauri 2)**
- [Tauri 2](https://v2.tauri.app/) — the Rust shell around the same web build; dual-licensed MIT/Apache-2.0.
- Plugins: [`shell`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/shell) (external links), and desktop-only [`updater`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater), `single-instance` and `process`.
- Rust crates: `serde`, `serde_json`, `tauri-build` (all MIT/Apache-2.0).

Dev-only tooling — dead-code detectors, type checkers, dependency auditors —
ships with nothing and is listed separately in
[`THIRD_PARTY.md`](./THIRD_PARTY.md).

### Maintainer

- **poli0981 / SkullMute** — the unemployed Vietnamese maintainer. ~30 % effort: occasionally opens Steam, scrolls the F2P section, queues new entries, plays on Easy to "verify" (verification level: noob / 10). Sometimes forgets for weeks. The other ~70 % is the AI assistants above plus the daily GitHub Actions cron doing data-refresh work while the maintainer sleeps.

### Tools

- IDE: whichever opens fastest with the darkest theme. VS Code most of the time.
- Other "tools": boredom, procrastination, sale addiction, and the eternal "hôm nay chơi free cái gì đây?".
- Steam library of 400+ games (80 % bought on sale under $10) for "research purposes".

### Contributing

Contributions welcome — see [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the issue templates under [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/). If you add a game, big thanks. If not, that's fine — the maintainer is used to zero social interaction anyway.

This repo is a solo-ish project powered by human laziness + AI assistance + GitHub free tier. Peace out ✨
