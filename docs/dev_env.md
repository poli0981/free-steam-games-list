# Developer environment

IDE, language toolchains, and the day-to-day workflow used to develop this repo. Mirrored in Vietnamese at [`i18n/vi/dev_env.md`](i18n/vi/dev_env.md).

## IDEs

| Tool       | Used for                                                           |
| ---------- | ------------------------------------------------------------------ |
| PyCharm    | `scripts/` Python pipeline (data fetcher, scraper, generator)      |
| WebStorm   | `web/src/` React + TypeScript + Vite                                |
| RustRover  | `web/src-tauri/` Tauri 2 desktop wrapper (Rust)                    |

JetBrains lineup, paid version, channel **2026.x**. Any equivalent editor (VS Code, Neovim, etc.) works — the repo is editor-agnostic.

## Toolchains

| Tool        | Version             | Notes                                         |
| ----------- | ------------------- | --------------------------------------------- |
| Python      | 3.12                | `scripts/` pipeline + Steam client            |
| Node.js     | ≥ 22 (LTS)          | web build, Tauri build pipeline               |
| Rust        | stable (via rustup) | Tauri runtime                                 |
| npm         | bundled with Node   | `web/package-lock.json` is the source of truth |
| Git         | recent              | GPG signing on (`commit.gpgsign=true`)         |
| Tauri CLI   | 2.x                 | invoked via `npm run tauri ...`                |

The CI workflows in [`.github/workflows/`](../.github/workflows) pin these versions explicitly. See [`release-desktop.yml`](../.github/workflows/release-desktop.yml) for the desktop build matrix and [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) for the web deploy.

## Dev workflow

### Web app

```bash
cd web
npm ci                   # one-time install
npm run dev              # http://localhost:5173 (Vite)
npm run typecheck        # strict TS
npm run build            # production bundle into web/dist
npm run preview          # serve the built bundle
```

Both `typecheck` and `build` must pass before opening a PR — there is no formal test suite for the React side, type-strictness is the safety net.

### Tauri desktop

```bash
cd web
npm run tauri dev        # dev build with hot reload, Rust + WebKit
npm run tauri build      # release binary into web/src-tauri/target/release/bundle
```

Platform prerequisites + signing notes live in [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md).

### Python pipeline

```bash
cd scripts
python -m pip install -r requirements.txt   # if a requirements file exists
python ingest_new.py                         # process scripts/temp_info.jsonl
python update_data.py                        # daily full refresh
python top_online.py                         # rebuild games/top-online.md
```

There is no formal unit-test suite — the pipeline is intentionally low-ceremony. Lint with `ruff` if you have it; otherwise rely on review.

### Git + GPG

- **Always** sign commits: `git config --local commit.gpgsign true`.
- Each commit lands as **Verified ✓** on GitHub when the GPG key is unlocked.
- Web-app edits go through the Git Data API and pick up the OpenPGP private key the maintainer pasted into Settings → see the GPG note in [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

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
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution paths (issue / web app / Telegram bot / extension / fork)
- [`../web/README.md`](../web/README.md) — web stack details + per-phase changelog
