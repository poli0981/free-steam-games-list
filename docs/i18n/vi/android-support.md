# Hỗ trợ Android & yêu cầu hệ thống

> Bản tiếng Anh ở [`../../android-support.md`](../../android-support.md).

File này giải thích **phiên bản Android tối thiểu** mà APK F2P Tracker yêu cầu,
**lý do**, và **những gì đã được test**. Số liệu đều có nguồn để bạn tự kiểm chứng.

## Yêu cầu tối thiểu

| | |
| --- | --- |
| **Tối thiểu** | **Android 11 (API 30)** trở lên |
| **Target / compile** | Android 16 (API 36) |
| **CPU/ABI** | APK universal — `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |

APK khai báo `minSdkVersion 30`. Trên máy cũ hơn Android 11, trình cài đặt của
Android **từ chối cài** (`INSTALL_FAILED_OLDER_SDK`) và báo *"App not installed"* /
*"cần phiên bản Android mới hơn"*. Đây là cơ chế do chính OS thực thi — không có
cách bypass trong app — nên ngưỡng phiên bản cũng chính là cổng chặn cài đặt.
(Đặt tại [`gen/android/app/build.gradle.kts`](../../../web/src-tauri/gen/android/app/build.gradle.kts) → `minSdk = 30`.)

## Vì sao Android 11+

1. **Bảo mật / hết vòng đời (EOL).** Google chỉ vá bảo mật OS cho các bản mới
   nhất. Tính đến 06/2026, chỉ còn **Android 14, 15 và 16** — Android 13 rời các
   security bulletin khoảng 03/2026, Android 12/12L ngày 31/03/2025, còn Android
   11 trở về trước thì đã EOL từ lâu. Chọn ngưỡng **11** thay vì 14 là cân bằng có
   chủ đích: bỏ phần đuôi *chết hẳn* (Android 7–10) mà vẫn phủ lượng lớn người
   dùng đang ở 11–13. **Lưu ý:** Android 11–13 không còn nhận bản vá bảo mật OS
   từ Google, dù vẫn cài được app.
2. **Tương thích WebView / React.** App là lớp vỏ native mỏng bọc UI web; mọi thứ
   render trong **Android System WebView** (Chromium). Các bản Android cũ thường
   mang WebView lỗi thời, dễ vỡ với output ES2022 / React 19 của bản build Vite 8
   / Rolldown. Ngưỡng OS cao hơn nâng nền Chromium tối thiểu và giảm rủi ro này.
   (WebView tự cập nhật độc lập qua Play Store, nên ai giữ nó mới thì ổn hơn —
   nhưng không thể trông cậy điều đó trên máy đã EOL.)
3. **Edge-to-edge & safe area.** Ta compile với `targetSdk 36` (Android 16), buộc
   layout edge-to-edge; UI dùng `env(safe-area-inset-*)` để né thanh status /
   gesture-nav. Những hành vi này ổn định nhất trên Android 11+.
4. **Phạm vi test.** Ta chỉ test từ Android 11 trở lên (xem dưới); không muốn ship
   một ngưỡng không thể smoke-test.

## Thiết bị đã test

| Loại | Thiết bị / target | Phiên bản Android |
| --- | --- | --- |
| Emulator | Android Studio AVD | **Android 11 → 16** (API 30–36) |
| Máy thật | **vivo 1907** | **Android 12** (API 31) |

Dưới Android 11 là không hỗ trợ và bị chặn ngay khi cài. Trên ngưỡng đó dự kiến
chạy được nhưng là best-effort ngoài ma trận trên. Gặp lỗi? Mở
[bug report](https://github.com/poli0981/free-steam-games-list/issues/new?template=bug_report.yml)
kèm thiết bị + phiên bản Android + screenshot.

## Bức tranh phiên bản Android (dữ liệu đằng sau quyết định)

Thị phần & trạng thái hỗ trợ bảo mật của các phiên bản Android toàn cầu, giữa 2026:

| Android | API | Google còn vá bảo mật OS? | Thị phần (StatCounter, 5/2026) | Tích luỹ (bản này trở lên) |
| --- | --- | --- | --- | --- |
| 16 (Baklava) | 36 | ✅ còn | 23.1% | 22.3% |
| 15 | 35 | ✅ còn | 18.1% | 41.0% |
| 14 | 34 | ✅ còn | 13.0% | 54.5% |
| 13 | 33 | ❌ EOL ~3/2026 | 14.3% | 68.9% |
| 12 / 12L | 31 / 32 | ❌ EOL 31/3/2025 | 10.0% | 78.8% |
| **11** | **30** | ❌ EOL ~2023 | 7.9% | **86.9%** |
| 10 trở về trước | ≤ 29 | ❌ | phần còn lại | — |

Vậy ngưỡng `minSdk 30` phủ khoảng **87% thiết bị Android đang hoạt động** mà chỉ
bỏ phần đuôi đã chết.

### Nguồn

- Bảng API ↔ version + phủ tích luỹ — [apilevels.com](https://apilevels.com/) (số tích luỹ cập nhật 28/05/2026 từ dữ liệu 04/2026).
- Thị phần từng bản — [StatCounter, Mobile Android Version, Worldwide](https://gs.statcounter.com/android-version-market-share/mobile/worldwide/) (5/2026).
- Ngày EOL bảo mật — [endoflife.date/android](https://endoflife.date/android) và [Android Security Bulletins](https://source.android.com/docs/security/bulletin) (một bản coi là EOL khi không còn xuất hiện trong bulletin hằng tháng).

## Liên quan

- [`../../../web/src-tauri/TAURI.md`](../../../web/src-tauri/TAURI.md) — yêu cầu build Android + CI.
- [`pc_spec.md`](pc_spec.md) — phần cứng maintainer + danh sách thiết bị test.
- [`../../DISCLAIMER.md`](../../DISCLAIMER.md) — lưu ý về độ chính xác dữ liệu.
