# Tauri 2 desktop build

This file documents how to build and run the desktop wrapper around the React web app. CI builds use the same recipe via [`.github/workflows/release-desktop.yml`](../../.github/workflows/release-desktop.yml).

## Prerequisites

| Tool       | Version             | Install                                                     |
| ---------- | ------------------- | ----------------------------------------------------------- |
| Node.js    | ≥ 22 (LTS)          | <https://nodejs.org/>                                       |
| Rust       | stable (via rustup) | <https://rustup.rs/>                                        |
| npm        | bundled with Node   | comes with Node                                             |
| Tauri CLI  | 2.x                 | invoked via `npx tauri` or `npm run tauri ...`               |

### Platform-specific deps

**Windows** — nothing extra (Tauri 2 ships its own WebView2 detection; install [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if missing).

**macOS** — Xcode Command Line Tools:
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian)** — same packages CI installs:
```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  build-essential \
  curl wget file
```

## Local dev

```bash
cd web
npm ci                  # install web deps once
npm run tauri dev       # dev build with hot reload
```

This boots Vite (`npm run dev`) under the hood and wires Tauri to it. The window opens at fixed 1400×900, dark theme, no resize.

## Production build

```bash
cd web
npm run tauri build
```

Output bundles land in `web/src-tauri/target/release/bundle/`:

| Platform | Artefact                  |
| -------- | ------------------------- |
| Windows  | `.msi`                    |
| macOS    | `.dmg` (universal binary) |
| Linux    | `.AppImage`, `.deb`       |

## Auto-update + signing

From v1.0 onwards the app polls the GitHub Releases page on launch and offers to download the next signed build. Updater clients reject unsigned binaries.

- Public minisign key is baked into [`tauri.conf.json`](tauri.conf.json).
- Private key + (optional) password live in repo Secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- The CI workflow injects them at build time. Local builds without these secrets still produce binaries, but updater clients won't trust them.

## CI

`.github/workflows/release-desktop.yml` triggers on:

- Push of any `desktop-v*` tag (e.g. `desktop-v1.1.0`)
- Manual `workflow_dispatch` with a tag input

It runs the build matrix (Win / macOS-universal / Linux), uploads installers as draft Release assets, and emits `latest.json` for the auto-updater (`includeUpdaterJson: true`).

## Troubleshooting

- **WebKit missing on Linux** — install `libwebkit2gtk-4.1-dev`. The CI workflow's apt-install line is the canonical list.
- **`napi-rs` build fails** — verify Rust toolchain is `stable` and `rustup target list --installed` includes the host triple.
- **macOS universal binary** — ensure both `aarch64-apple-darwin` and `x86_64-apple-darwin` targets are added (`rustup target add ...`). CI does this in the `dtolnay/rust-toolchain` step.
- **Updater silent on sideloaded copies** — sideloaded installs have a different bundle identifier; only the official MSI/DMG/AppImage receive update prompts.

## Known advisories

- **`glib` (GHSA-wrw7-89jp-8q8g, medium, Linux-only)** — accepted, no upstream fix available. The gtk-rs binding stack is pinned at `glib 0.18` by the latest `webkit2gtk` crate (2.0.2, which requires `glib ^0.18`) and by `tao`/`wry` (`gtk ^0.18`). The patched `glib 0.20` needs a gtk-rs 0.20 stack that no released Tauri 2.x ships, and Tauri 3 is not out yet. Only the **Linux** build links glib (Windows uses WebView2, macOS uses Cocoa), and the app does not exercise the affected API, so the Dependabot alert is dismissed as *tolerable risk*. Re-check when `tauri`/`wry`/`webkit2gtk` adopt gtk-rs 0.20, then `cargo update` and re-enable the alert.

## Related

- [`../../docs/dev_env.md`](../../docs/dev_env.md) — IDE + toolchain
- [`../../docs/pc_spec.md`](../../docs/pc_spec.md) — maintainer hardware spec
- [`../../.github/workflows/release-desktop.yml`](../../.github/workflows/release-desktop.yml) — CI build pipeline
- [Tauri 2 docs](https://v2.tauri.app/) — upstream
