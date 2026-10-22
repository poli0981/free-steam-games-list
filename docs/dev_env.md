# Developer environment

IDE, language toolchains, and the day-to-day workflow used to develop this repo. Mirrored in Vietnamese at [`i18n/vi/dev_env.md`](i18n/vi/dev_env.md).

## IDEs

| Tool       | Used for                                                           |
| ---------- | ------------------------------------------------------------------ |
| PyCharm    | `scripts/` Python pipeline (data fetcher, scraper, generator)      |
| WebStorm   | `web/` SvelteKit + Svelte 5 + TypeScript, the Worker, `admin/`     |
| RustRover  | `web/src-tauri/` Tauri 2 desktop wrapper (Rust)                    |

JetBrains lineup, paid version, channel **2026.x**. Any equivalent editor (VS Code, Neovim, etc.) works — the repo is editor-agnostic.

## Toolchains

| Tool        | Version             | Notes                                         |
| ----------- | ------------------- | --------------------------------------------- |
| Python      | 3.15                | `scripts/` pipeline + Steam client            |
| Node.js     | 26 (`web/.node-version`) | web build, tests (`node:sqlite`), Tauri build |
| TypeScript  | 7 + 6               | 7 (`@typescript/native`) type-checks; 6 stays for svelte-check and `svelte-kit sync` |
| Rust        | stable (via rustup) | Tauri runtime                                 |
| npm         | bundled with Node   | `web/package-lock.json` is the source of truth |
| Git         | recent              | GPG signing on (`commit.gpgsign=true`)         |
| Tauri CLI   | 2.x                 | invoked via `npm run tauri ...`                |

The CI workflows in [`.github/workflows/`](../.github/workflows) pin these versions explicitly, and `web/shared/toolchain.test.ts` fails when one of them drifts from the others (CodeQL's Python is the one named exception). See [`release-desktop.yml`](../.github/workflows/release-desktop.yml) for the desktop build matrix and [`web-ci.yml`](../.github/workflows/web-ci.yml) for the web checks. The site itself is deployed by Cloudflare Workers Builds on a push to `main` — see [`DEPLOYMENT.md`](DEPLOYMENT.md). Why TypeScript is two packages, and how to move each runtime next time: [`plan/16-toolchain-2026.md`](plan/16-toolchain-2026.md); the switch to TypeScript 7 alone, planned for 7.1: [`plan/17-typescript-7.1.md`](plan/17-typescript-7.1.md).

## Dev workflow

### Web app

```bash
cd web
npm ci                   # one-time install
npm run dev              # http://localhost:5173 (Vite)
npm run dev:admin        # http://localhost:5174/admin, the admin app on a local mock backend
npm run typecheck        # strict TS: app, admin, Worker, tests
npm test                 # vitest
npm run build            # site into web/dist, admin into the Worker bundle
node scripts/verify-dist.mjs --web
```

`typecheck`, `test` and `build` must all pass before opening a PR; `web-ci.yml` runs the same, plus a Tauri-flavour build.

### Tauri desktop

```bash
cd web
npm run tauri dev        # dev build with hot reload, Rust + WebKit
npm run tauri build      # release binary into web/src-tauri/target/release/bundle
```

Platform prerequisites + signing notes live in [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md).

### Python pipeline

From the repo root: the scripts read and write `data/` by a relative path.

```bash
python -m pip install --require-hashes --only-binary :all: -r requirements.txt
python -m pip install --require-hashes --only-binary :all: -r requirements-test.txt   # pytest
python scripts/ingest_new.py                 # process scripts/temp_info.jsonl
python scripts/update_data.py                # daily full refresh
python scripts/top_online.py                 # rebuild games/top-online.md
```

`requirements.txt` pins every package with its hashes, so pip refuses anything else; install the unhashed `requirements-dev.txt` (vulture, pip-audit) in a separate call. `python -m pytest scripts/tests` covers the pipeline's contracts; `python-tests.yml` runs it on every change under `scripts/` or to the requirements files. Lint with `ruff` if you have it; otherwise rely on review.

### Git + GPG

- **Always** sign commits: `git config --local commit.gpgsign true`.
- Each commit lands as **Verified ✓** on GitHub when the GPG key is unlocked.
- The web app no longer commits anything. Commits made from `/admin` are created by a GitHub App through `createCommitOnBranch`, which GitHub signs itself — see [`ADMIN.md`](ADMIN.md).

## Branch + PR flow

Per the maintainer's working style:

1. Cut a feature branch from `main`.
2. Implement + run `npm run typecheck && npm run build` (web) or `python scripts/<task>.py` (pipeline).
3. Squash-commit with a short, scoped message.
4. Push, open PR, squash-merge to `main` once green.

Larger features (multi-task batches like the v3.x release cycle) are landed in phase-PRs that group related work to keep history scannable.

## Related

- [`pc_spec.md`](pc_spec.md) — hardware spec
- [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md) — Tauri 2 desktop build prerequisites
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution paths (issue / discussion / fork)
- [`../web/README.md`](../web/README.md) — web stack details + per-phase changelog
