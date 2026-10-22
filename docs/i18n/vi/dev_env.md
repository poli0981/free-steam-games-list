# Môi trường dev

IDE, toolchain ngôn ngữ, và workflow hàng ngày khi phát triển repo này. Bản tiếng Anh ở [`../../dev_env.md`](../../dev_env.md).

## IDE

| Tool       | Dùng cho                                                          |
| ---------- | ----------------------------------------------------------------- |
| PyCharm    | `scripts/` Python pipeline (fetcher, scraper, generator)          |
| WebStorm   | `web/` SvelteKit + Svelte 5 + TypeScript, Worker, `admin/`       |
| RustRover  | `web/src-tauri/` Tauri 2 desktop wrapper (Rust)                   |

Lineup JetBrains, bản trả phí, channel **2026.x**. Editor khác (VS Code, Neovim, ...) cũng OK — repo không bind editor cụ thể.

## Toolchain

| Tool       | Version             | Ghi chú                                          |
| ---------- | ------------------- | ------------------------------------------------ |
| Python     | 3.15                | `scripts/` pipeline + Steam client               |
| Node.js    | 26 (`web/.node-version`) | web build, test (`node:sqlite`), build Tauri |
| TypeScript | 7 + 6               | 7 (`@typescript/native`) type-check; 6 giữ lại cho svelte-check và `svelte-kit sync` |
| Rust       | stable (via rustup) | Tauri runtime                                    |
| npm        | đi kèm Node         | `web/package-lock.json` là source of truth       |
| Git        | mới                 | GPG signing on (`commit.gpgsign=true`)            |
| Tauri CLI  | 2.x                 | gọi qua `npm run tauri ...`                       |

CI workflow trong [`.github/workflows/`](../../../.github/workflows) đã pin các version này, và `web/shared/toolchain.test.ts` sẽ fail khi một chỗ lệch khỏi các chỗ còn lại (Python của CodeQL là ngoại lệ duy nhất, được khai tên). Xem [`release-desktop.yml`](../../../.github/workflows/release-desktop.yml) cho matrix build desktop và [`web-ci.yml`](../../../.github/workflows/web-ci.yml) cho các bước kiểm tra web. Bản thân trang web được Cloudflare Workers Builds deploy mỗi khi push lên `main` — xem [`DEPLOYMENT.md`](../../DEPLOYMENT.md). Vì sao TypeScript là hai gói, và cách nâng từng runtime lần sau: [`plan/16-toolchain-2026.md`](../../plan/16-toolchain-2026.md); kế hoạch chuyển hẳn sang TypeScript 7 khi có bản 7.1: [`plan/17-typescript-7.1.md`](../../plan/17-typescript-7.1.md).

## Workflow dev

### Web app

```bash
cd web
npm ci                   # cài lần đầu
npm run dev              # http://localhost:5173 (Vite)
npm run dev:admin        # http://localhost:5174/admin, app admin chạy trên backend giả lập
npm run typecheck        # TS strict: app, admin, Worker, test
npm test                 # vitest
npm run build            # site vào web/dist, admin vào bundle của Worker
node scripts/verify-dist.mjs --web
```

`typecheck`, `test` và `build` đều phải pass trước khi mở PR; `web-ci.yml` chạy đúng các bước đó, kèm một bản build cấu hình Tauri.

### Tauri desktop

```bash
cd web
npm run tauri dev        # dev build hot reload (Rust + WebKit)
npm run tauri build      # release binary vào web/src-tauri/target/release/bundle
```

Platform prerequisites + ghi chú signing ở [`../../../web/src-tauri/TAURI.md`](../../../web/src-tauri/TAURI.md).

### Python pipeline

Chạy từ thư mục gốc của repo: các script đọc và ghi `data/` theo đường dẫn tương đối.

```bash
python -m pip install --require-hashes --only-binary :all: -r requirements.txt
python -m pip install --require-hashes --only-binary :all: -r requirements-test.txt   # pytest
python scripts/ingest_new.py                 # xử lý scripts/temp_info.jsonl
python scripts/update_data.py                # daily full refresh
python scripts/top_online.py                 # rebuild games/top-online.md
```

`requirements.txt` ghim mọi package kèm hash, nên pip từ chối mọi thứ khác; cài `requirements-dev.txt` (vulture, pip-audit, không có hash) bằng một lệnh riêng. `python -m pytest scripts/tests` kiểm tra các ràng buộc của pipeline; `python-tests.yml` chạy nó mỗi khi `scripts/` hoặc các file requirements thay đổi. Lint bằng `ruff` nếu có; còn lại dựa vào review.

### Git + GPG

- **Luôn** sign commit: `git config --local commit.gpgsign true`.
- Mỗi commit hiện **Verified ✓** trên GitHub khi GPG key đã unlock.
- Web app không còn tự commit. Commit từ `/admin` do một GitHub App tạo qua `createCommitOnBranch` và được GitHub tự ký — xem [`ADMIN.md`](../../ADMIN.md).

## Branch + PR flow

Theo style của maintainer:

1. Cắt feature branch từ `main`.
2. Implement + chạy `npm run typecheck && npm run build` (web) hoặc `python scripts/<task>.py` (pipeline).
3. Squash-commit với message ngắn, scope rõ.
4. Push, mở PR, squash-merge vào `main` khi green.

Feature lớn (gộp nhiều task như v3.x) gom thành phase-PR để history dễ scan.

## Liên quan

- [`pc_spec.md`](pc_spec.md) — cấu hình máy
- [`../../../web/src-tauri/TAURI.md`](../../../web/src-tauri/TAURI.md) — yêu cầu build Tauri 2 desktop
- [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) — các đường đóng góp (issue / discussion / fork)
- [`../../../web/README.md`](../../../web/README.md) — chi tiết stack web + changelog từng phase
