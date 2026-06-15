# Cấu hình máy dev

File này ghi cấu hình máy mà maintainer (poli0981 / SkullMute) thực sự đang dùng để phát triển, build và test repo này. Bản tiếng Anh ở [`../../pc_spec.md`](../../pc_spec.md).

Đây **không phải** yêu cầu hệ thống cho user — web app chạy trên mọi browser hiện đại, còn desktop app chỉ cần Tauri 2 platform deps (xem [`../../../web/src-tauri/TAURI.md`](../../../web/src-tauri/TAURI.md)). **APK Android** là bề mặt duy nhất có ngưỡng thật — **Android 11+** (xem [`android-support.md`](android-support.md)).

## Máy dev chính

| Component   | Chi tiết                                                         |
| ----------- | ---------------------------------------------------------------- |
| **OS**      | Windows 11 Pro 25H2 Insider Preview (Dev Channel)                |
| **Build**   | 26300.8376                                                       |
| **CPU**     | Intel Core i7-14700KF                                            |
| **GPU**     | NVIDIA GeForce RTX 5080 (16 GB VRAM)                             |
| **RAM**     | 32 GB DDR5                                                       |
| **Storage** | 1 TB SSD                                                         |
| **IDE**     | JetBrains 2026.x (bản trả phí) — PyCharm, WebStorm, RustRover    |

## Thiết bị test (web app)

Web app + desktop build được smoke-test trên:

- **iPhone 14 Pro** — iOS 26.x, Safari + Chrome + Brave
- **iPhone 13 Pro Max** — iOS 26.x, Safari + Chrome + Brave
- **Desktop browser** — Chrome, Edge, Firefox, Brave (Windows 11)

Ngoài danh sách trên là best-effort. Nếu render lỗi ở chỗ lạ, mở [bug report](https://github.com/poli0981/free-steam-games-list/issues/new?template=bug_report.yml) — kèm browser + OS + screenshot.

## Thiết bị test (app Android)

APK sideload yêu cầu **Android 11 (API 30)** trở lên (máy cũ hơn bị chặn ngay khi cài). Đã smoke-test trên:

- **Emulator** — Android Studio AVD, **Android 11 → 16** (API 30–36)
- **Máy thật** — **vivo 1907**, Android 12 (API 31)

Xem [`android-support.md`](android-support.md) để biết lý do chọn ngưỡng + thị phần các phiên bản Android.

## Liên quan

- [`dev_env.md`](dev_env.md) — IDE + toolchain + workflow dev
- [`../../../web/src-tauri/TAURI.md`](../../../web/src-tauri/TAURI.md) — yêu cầu build desktop
- [`../../../AUTHORS.md`](../../../AUTHORS.md) — profile maintainer + liên hệ
