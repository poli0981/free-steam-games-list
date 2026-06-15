# PC spec — developer machine

This file documents the hardware the maintainer (poli0981 / SkullMute) actually uses to develop, build, and test this repo. It is mirrored in Vietnamese at [`i18n/vi/pc_spec.md`](i18n/vi/pc_spec.md).

It is **not** a system requirement for users — the web app runs in any modern browser, and the desktop app only needs the Tauri 2 platform deps (see [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md)). The **Android APK** is the one surface with a real floor — **Android 11+** (see [`android-support.md`](android-support.md)).

## Developer machine (primary)

| Component   | Details                                                     |
| ----------- | ----------------------------------------------------------- |
| **OS**      | Windows 11 Pro 25H2 Insider Preview (Dev Channel)           |
| **Build**   | 26300.8376                                                  |
| **CPU**     | Intel Core i7-14700KF                                       |
| **GPU**     | NVIDIA GeForce RTX 5080 (16 GB VRAM)                        |
| **RAM**     | 32 GB DDR5                                                  |
| **Storage** | 1 TB SSD                                                    |
| **IDE**     | JetBrains 2026.x — paid lineup (PyCharm, WebStorm, RustRover) |

## Test devices (web app)

The web app + desktop builds are smoke-tested on:

- **iPhone 14 Pro** — iOS 26.x, Safari + Chrome + Brave
- **iPhone 13 Pro Max** — iOS 26.x, Safari + Chrome + Brave
- **Desktop browsers** — Chrome, Edge, Firefox, Brave (Windows 11)

Anything outside this set is best-effort. File a [bug report](https://github.com/poli0981/free-steam-games-list/issues/new?template=bug_report.yml) if rendering breaks somewhere unusual — include browser + OS + screenshot.

## Test devices (Android app)

The sideloadable APK requires **Android 11 (API 30)** or newer (older devices are blocked at install time). Smoke-tested on:

- **Emulator** — Android Studio AVD, **Android 11 → 16** (API 30–36)
- **Real phone** — **vivo 1907**, Android 12 (API 31)

See [`android-support.md`](android-support.md) for the minimum-version rationale + worldwide version stats.

## Related

- [`dev_env.md`](dev_env.md) — IDE + toolchains + dev workflow
- [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md) — desktop build prerequisites
- [`../AUTHORS.md`](../AUTHORS.md) — maintainer profile + contact
