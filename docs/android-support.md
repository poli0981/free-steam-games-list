# Android support & system requirements

> Mirrored in Vietnamese at [`i18n/vi/android-support.md`](i18n/vi/android-support.md).

This document explains the **minimum Android version** the F2P Tracker APK
requires, **why**, and **what we test on**. Numbers are sourced so you can check
them yourself.

## Minimum requirement

| | |
| --- | --- |
| **Minimum** | **Android 11 (API level 30)** or newer |
| **Target / compiled against** | Android 16 (API 36) |
| **CPU/ABI** | universal APK — `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |

The APK declares `minSdkVersion 30`. On a device older than Android 11, Android's
package installer **refuses to install** it (`INSTALL_FAILED_OLDER_SDK`) and shows
*"App not installed"* / *"requires a newer version of Android"*. This is enforced
by the OS itself — there is no in-app bypass — so the version floor is also the
install gate. (Set in [`gen/android/app/build.gradle.kts`](../web/src-tauri/gen/android/app/build.gradle.kts) → `minSdk = 30`.)

## Why Android 11+

1. **Security / end-of-life.** Google only ships OS-level security backports for
   the latest releases. As of June 2026 that is **Android 14, 15 and 16** only —
   Android 13 left the security bulletins around March 2026, Android 12/12L on
   31 March 2025, and Android 11 and older are long past it. We set the floor at
   **11** rather than 14 as a deliberate balance: it removes the *deeply* dead
   tail (Android 7–10) while still covering the large installed base on 11–13.
   **Be aware:** Android 11–13 no longer receive OS security patches from Google,
   even though they can still install the app.
2. **WebView / React compatibility.** The app is a thin native shell around the
   web UI; everything renders in the **Android System WebView** (Chromium). Old
   Android releases tend to carry an outdated WebView, which can choke on the
   modern ES2022 / React 19 output of our Vite 8 / Rolldown build. A newer OS
   floor raises the guaranteed Chromium baseline and reduces that breakage risk.
   (The WebView itself updates independently via the Play Store, so users who
   keep it current fare better — but we can't rely on that on EOL devices.)
3. **Edge-to-edge & safe areas.** We compile against `targetSdk 36` (Android 16),
   which forces edge-to-edge layout; the UI uses `env(safe-area-inset-*)` to dodge
   the status / gesture-nav bars. These behave most reliably on Android 11+.
4. **Tested surface.** We only test from Android 11 upward (see below); we don't
   want to ship a floor we can't smoke-test.

## Tested devices

| Type | Device / target | Android version |
| --- | --- | --- |
| Emulator | Android Studio AVD | **Android 11 → 16** (API 30–36) |
| Real phone | **vivo 1907** | **Android 12** (API 31) |

Anything below Android 11 is unsupported and blocked at install time. Anything
above is expected to work but is best-effort beyond the matrix above. Found a
problem? File a [bug report](https://github.com/poli0981/free-steam-games-list/issues/new?template=bug_report.yml)
with device + Android version + screenshot.

## Android version landscape (the data behind the decision)

Worldwide Android version share and security-support status, mid-2026:

| Android | API | Google OS security patches? | Share (StatCounter, May 2026) | Cumulative (this version or newer) |
| --- | --- | --- | --- | --- |
| 16 (Baklava) | 36 | ✅ supported | 23.1% | 22.3% |
| 15 | 35 | ✅ supported | 18.1% | 41.0% |
| 14 | 34 | ✅ supported | 13.0% | 54.5% |
| 13 | 33 | ❌ EOL ~Mar 2026 | 14.3% | 68.9% |
| 12 / 12L | 31 / 32 | ❌ EOL 31 Mar 2025 | 10.0% | 78.8% |
| **11** | **30** | ❌ EOL ~2023 | 7.9% | **86.9%** |
| 10 and older | ≤ 29 | ❌ | remainder | — |

A `minSdk 30` floor therefore reaches roughly **87% of active Android devices**
while dropping only the long-dead tail.

### Sources

- API level ↔ version mapping and cumulative usage — [apilevels.com](https://apilevels.com/) (cumulative figures updated 28 May 2026 from April 2026 data).
- Per-version market share — [StatCounter, Mobile Android Version, Worldwide](https://gs.statcounter.com/android-version-market-share/mobile/worldwide/) (May 2026).
- Security end-of-life dates — [endoflife.date/android](https://endoflife.date/android) and the [Android Security Bulletins](https://source.android.com/docs/security/bulletin) (a release is treated as EOL once it stops appearing in the monthly bulletins).

## Related

- [`../web/src-tauri/TAURI.md`](../web/src-tauri/TAURI.md) — Android build prerequisites + CI.
- [`pc_spec.md`](pc_spec.md) — maintainer hardware + the full test-device list.
- [`DISCLAIMER.md`](DISCLAIMER.md) — data-accuracy caveats.
