# Authors

This file lives at the repo root so the author can be found without digging into the docs. The canonical handle map is also in [`username.txt`](username.txt) (machine-readable) and rendered in the web app's [About page](https://free-steam-games.win/about).

## Maintainer

**poli0981** — Vietnamese developer, hobbyist, runs this in spare time.

| Channel | Handle / URL |
|---|---|
| GitHub | [@poli0981](https://github.com/poli0981) |
| Email | `contact@poli0981.dev` |
| Everything else | <https://poli0981.dev/links/> |

`poli0981.dev/links/` is the single source of truth for every other channel
— chat, socials, video, donations. It is maintained there rather than in
this repository so a moved or retired account cannot leave a dead link here.

Anything that should not be public belongs in email, or in GitHub's private
vulnerability reporting — see [`SECURITY.md`](SECURITY.md).

## Dev info

For people forking the repo or trying to reproduce a build:

| Item            | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| GitHub          | [@poli0981](https://github.com/poli0981)                     |
| IDE             | JetBrains 2026.x — paid lineup (PyCharm, WebStorm, RustRover) |
| Toolchains      | Python 3.12 · Node.js ≥ 22 · Rust stable · Tauri 2           |
| Git             | GPG signing on (`commit.gpgsign=true`)                        |
| Hardware spec   | [`docs/pc_spec.md`](docs/pc_spec.md) (EN) · [`docs/i18n/vi/pc_spec.md`](docs/i18n/vi/pc_spec.md) (VI) |
| Dev environment | [`docs/dev_env.md`](docs/dev_env.md) (EN) · [`docs/i18n/vi/dev_env.md`](docs/i18n/vi/dev_env.md) (VI) |
| Desktop build   | [`web/src-tauri/TAURI.md`](web/src-tauri/TAURI.md)            |
| Test devices    | iPhone 14 Pro · iPhone 13 Pro Max · iOS 26.x (Chrome / Brave / Safari) |

## Contributors

Anyone who's filed an issue, opened a PR, or used the Add-Games template is implicitly thanked. The full list is whatever GitHub renders on the [contributors page](https://github.com/poli0981/free-steam-games-list/graphs/contributors).

## AI assistants (full disclosure)

About **~70 %** of the code in this repository was generated with help from large-language-model assistants:

- **Grok (xAI)** — initial v1 Python pipeline (~2025).
- **Claude (Anthropic)** — v2 refactor, full data layer, the React/Vite web app, the Tauri 2 desktop wrapper, the GPG-signing path, the legal docs, and most recent commits.

Generated code is reviewed and tested before each commit. No user data is sent to any LLM at runtime — LLM calls happen on the maintainer's dev machine, never from your browser.

## Licensing

Code, docs and the web app are [MIT-licensed](LICENSE). The **dataset** (`data/**`, `games/**`) is licensed separately under [CC BY 4.0](LICENSE-DATA). Fork freely; please keep the credit.
