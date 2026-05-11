# PC spec — developer machine

This file documents the hardware the maintainer (poli0981 / SkullMute) actually uses to develop, build, and test this repo. It is mirrored in Vietnamese at [`i18n/vi/pc_spec.md`](i18n/vi/pc_spec.md).

It is **not** a system requirement for users — the web app runs in any modern browser, and the desktop app only needs the Tauri 2 platform deps (see [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md)).

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

## Related

- [`dev_env.md`](dev_env.md) — IDE + toolchains + dev workflow
- [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md) — desktop build prerequisites
- [`../AUTHORS.md`](../AUTHORS.md) — maintainer profile + contact
