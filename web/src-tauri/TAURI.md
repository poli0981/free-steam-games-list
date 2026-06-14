# Tauri 2 desktop + Android build

This file documents how to build and run the Tauri wrapper around the React web app — both the **desktop** bundles and the sideloadable **Android** APK. CI builds use the same recipes via [`.github/workflows/release-desktop.yml`](../../.github/workflows/release-desktop.yml) and [`.github/workflows/release-android.yml`](../../.github/workflows/release-android.yml).

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

## Android build

The same web app packages as a sideloadable Android APK via Tauri 2 mobile. The Gradle project is committed under [`gen/android/`](gen/android) (generated once with `tauri android init`); the build artefacts inside it are gitignored. CI: [`.github/workflows/release-android.yml`](../../.github/workflows/release-android.yml).

### Prerequisites (in addition to Node + Rust above)

| Tool | Notes |
| ---- | ----- |
| Android Studio | Brings the SDK + a bundled JDK (JBR). |
| Android SDK | Platform-Tools, Build-Tools, a recent Platform — Gradle auto-installs missing ones. |
| Android NDK | "Side by side"; any recent r26/r27/r30 works (built here with r30). |
| JDK | 17 recommended; the bundled JBR 21 also builds. |
| Rust targets | `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |

Env vars (Windows example — set the NDK to the exact versioned folder):
```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME     = "$env:ANDROID_HOME\ndk\<version>"
$env:JAVA_HOME    = "<Android Studio>\jbr"
```

### Build

```bash
cd web
npm run tauri:android:build                                   # signed universal release APK (all ABIs)
npm run tauri:android:dev                                     # run on emulator / connected device
npm run tauri -- android build --apk --debug --target aarch64 # fast debug build, single ABI
```

Output: `gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. Minimum Android 7.0 (API 24).

### Signing

Release APKs sign from `gen/android/keystore.properties` (gitignored), pointing at a keystore you generate once:

```bash
keytool -genkeypair -v -keystore f2p-tracker-release.jks \
  -alias f2p-tracker -keyalg RSA -keysize 2048 -validity 10000
```
`keystore.properties` has four lines: `storeFile` (absolute path, forward slashes), `storePassword`, `keyAlias`, `keyPassword`. **Back up the keystore + passwords** — every future update must reuse the same key, or users have to uninstall first. Without the file the release build stays unsigned (and won't install).

### CI

`release-android.yml` triggers on `android-v*` tags (or manual dispatch), decodes the keystore from repo Secrets, builds a signed universal APK, and attaches it to a draft Release. Required Secrets:

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 f2p-tracker-release.jks` (or PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("f2p-tracker-release.jks"))`)
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

### Notes

- **No auto-updater on Android** — `tauri-plugin-updater` is desktop-only. Updates are manual: install a newer APK over the top (same signing key → no uninstall).
- **Edge-to-edge** — targetSdk 36 forces it; the layout uses `env(safe-area-inset-*)` to dodge the status / gesture-nav bars.
- **OAuth Device Flow** routes through `@tauri-apps/plugin-http` because the Android System WebView enforces CORS on the `github.com/login/*` endpoints (desktop's webview doesn't). PAT sign-in needs no native bridge.
- **Kotlin cross-drive warning** — if the Cargo registry (`C:`) and the project (`E:`) are on different drives, Kotlin incremental compilation falls back to non-incremental every build (slower, harmless). Move `CARGO_HOME` to the project's drive, or set `kotlin.incremental=false` in `gen/android/gradle.properties`, to avoid it.

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
