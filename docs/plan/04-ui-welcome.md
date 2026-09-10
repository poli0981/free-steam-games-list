I've read the full UI surface. Here is the design.

---

# UI Refresh + Welcome Page — Design Spec

## 0. What I found that constrains the design

| Finding | Evidence |
|---|---|
| The app is **de facto dark-only** despite having a light palette | `web/index.html:2` hardcodes `class="dark"`; `web/src/main.tsx:36` hardcodes `theme="dark"` on `<Toaster>`; `web/src/components/charts/EChart.tsx:101` passes `theme="dark"`; ~45 hardcoded hex colors in `web/src/components/charts/*.tsx`, six of which are `#0f172a` used as "the page background" for chart borders (`GenreTreemap.tsx:40,44`, `PlatformsDonut.tsx:51`, `PlayerTiersPie.tsx:50`, `LanguagesHeatmap.tsx:76`, `DelistedReasonBreakdown.tsx:41`) — these paint dark seams on a white card in light mode |
| `theme="dark"` on EChart is a **no-op** | `echarts.registerTheme` appears nowhere in the tree; ECharts silently falls back to its default theme |
| **Inter is never loaded** | `web/tailwind.config.ts:51` declares `sans: ["Inter", …]` but there is no `@font-face` and no font `<link>` in `index.html`. The app has always rendered in `system-ui` |
| `system` theme never reacts | `web/src/components/layout/Topbar.tsx:23-26` reads `matchMedia` once, no `change` listener |
| Theme is applied **after first paint** | `Topbar.tsx:45` initializes from localStorage at Topbar mount — ConsentGate paints first, always dark (`index.html:2`) |
| 21 links in a 240px rail | `Sidebar.tsx:37-42` (4) + `:44-56` (11) + `:62-69` (6); `Trophy` used twice (`:40,:41`), `Shield` used twice (`:49,:50`) |
| Command palette is **not translated** | `CommandPalette.tsx:49-65` — 17 hardcoded English labels inside an otherwise i18n'd app |
| KPI labels are **not translated** | `web/src/components/charts/KpiCards.tsx:69-118` — 7 labels + hints in English |
| No skip link, no reduced-motion block, no focus-visible base rule | `web/src/index.css` is 69 lines and contains none of them |
| Command palette has no focus trap/restore | `CommandPalette.tsx:121` is a raw `<div>` overlay, not a Radix Dialog |
| `⌘K` handler breaks Vietnamese IME | `CommandPalette.tsx:78` doesn't check `e.isComposing` |

---

## 1. The welcome page

### 1.1 Route, not a gate step

**It is a real route: `/welcome`, rendered outside `<Layout>`** (no sidebar, no topbar), inside the router, inside `ConsentGate`.

Reasons it must be a route rather than a second panel inside `ConsentGate.tsx`:
- Requirement says users get back to it later — a step inside the gate is unlinkable.
- After the BrowserRouter migration, `/welcome` is a real shareable/indexable URL — it is the natural marketing landing for `free-steam-games.win`.
- It needs `useGames()` (live count + `last_updated`); `ConsentGate` is deliberately data-free and eager so it paints instantly (`ConsentGate.tsx:11-18`).
- The Cloudflare `not_found_handling: "single-page-application"` already serves `index.html` for `/welcome`, so no extra Worker route is needed.

### 1.2 Ordering

```
main.tsx
└ StrictMode
  └ AppErrorBoundary
    └ QueryClientProvider
      └ BrowserRouter                       ← was HashRouter (main.tsx:29)
        └ ConsentGate                       ← unchanged position, still blocks everything but /error/*
          └ App (Routes)
             ├ /welcome        → <WelcomePage/>          (chrome-less)
             └ element=<Layout/>
                ├ index (/)    → <WelcomeGate><Dashboard/></WelcomeGate>
                └ …every other route, ungated
```

Consent always comes first. `/welcome` is **not** added to the `/error/*` bypass at `ConsentGate.tsx:30`.

`WelcomeGate` wraps **only the index route**. Deep links (`/games/570`, a bookmarked chart, a shared leaderboard) are never interrupted — interrupting a deep link with an onboarding screen is hostile. The PWA `start_url` and the Tauri shell both load `/`, so first-run on web, desktop, and Android all land on the welcome page.

```tsx
// web/src/components/common/WelcomeGate.tsx  (new)
export function WelcomeGate({ children }: { children: React.ReactNode }) {
  const seen = useWelcome((s) => s.seen);
  if (!seen) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}
```

### 1.3 Persistence

New store `web/src/stores/welcome.ts`, deliberately mirroring `web/src/stores/consent.ts:9-57`:

```ts
const KEY = "f2p:welcome_seen";
/** Bump when the welcome content changes materially (domain move, licence split). */
export const WELCOME_VERSION = 1;
interface StoredWelcome { version: number; seenAt: string }
// seen = stored?.version === WELCOME_VERSION
// actions: markSeen(), reset()
```

Independent of `TERMS_VERSION` (`consent.ts:15`) on purpose: a legal re-prompt should not force a welcome re-show, and vice versa. Same try/catch-around-localStorage pattern (blocked storage → welcome simply re-shows, harmless).

`markSeen()` fires from a mount effect on `WelcomePage`. It is an idempotent single localStorage write, so React 19 StrictMode's double-invoked effect is safe — call this out in the code comment. Reloading while *on* `/welcome` keeps you on `/welcome` regardless of the flag; the flag only governs the redirect from `/`.

### 1.4 Getting back to it

1. Command palette, Pages group: `nav.welcome` (`CommandPalette.tsx:48` `NAV` array).
2. `/about` page header: `<Button variant="link" asChild><Link to="/welcome">`.
3. Sidebar footer cluster (see §3), under System.
4. **Settings → "Show the welcome page again"** calls `useWelcome.getState().reset()`, so the next visit to `/` lands there. Useful for demos and for testing the first-run path without clearing all storage.

### 1.5 Sections — "simple, short, complete"

One column, `max-w-3xl`, ~450 words total, ≤2 phone screens. Every claim is sourced from `docs/DISCLAIMER.md` so the welcome and the legal doc cannot drift.

| # | Section | Content | Source |
|---|---|---|---|
| 1 | **Hero** | Name, one-line tagline, three live stats: game count from `useGames().data.records.length`, `index.last_updated`, "open data". Skeletons while the query is in flight — **the page must render before data lands**. Never hardcode a count (the `1,200+` at `index.html:17,26,29,59` is exactly this bug; real value is 3,424) | `hooks/useGames` |
| 2 | **What this is** | 3 bullets: curated F2P Steam catalogue with players/reviews/genres/platforms/languages/anti-cheat/DRM; one person's hobby, **not a Valve or Steam product, no affiliation**; everything is public JSONL in a Git repo you can fork | `About.tsx:206-208` |
| 3 | **Read this before you trust a number** | The honest framing, verbatim in spirit: provided "as is", no warranty; not complete or accurate — check the Steam page; genre is a best guess, use tags; player counts are samples lagging minutes-to-hours; `safe` is one person's opinion, not antivirus. Ends with an external link to the full Disclaimer via `legalDocUrl("docs/DISCLAIMER.md")` + `openExternal()` so Tauri opens the system browser | `docs/DISCLAIMER.md:3,15,27-28,42-43,45-46`; pattern from `ConsentGate.tsx:86` |
| 4 | **How often it updates** | "A scheduled pipeline re-reads Steam once a day and commits what changed; the maintainer also edits by hand. No uptime or freshness guarantee — this is a hobby, not a service." + the live `last_updated` stamp + one line on the IndexedDB cache and revalidation against `data/index.json` | `docs/DISCLAIMER.md:17,54-56`; `lib/cache.ts` |
| 5 | **Where to start** | 4 `<Link>` cards: Browse the catalogue `/games`, Leaderboards `/leaderboards`, Charts `/charts`, Data health `/health`. Plus a search hint that is **`⌘K` text on pointer:fine and a real button calling `openCommandPalette()` on touch** (already exported at `CommandPalette.tsx:36`) | — |
| 6 | **Language and appearance** | Two segmented controls: `<LanguageToggle/>` (reuses `setLanguage()` from `i18n/index.ts:95`) and `<ThemeToggle/>` (new store, §4). This is where a Vietnamese-default user switches to English in one tap without hunting through Settings | `Settings.tsx:68-97` |
| 7 | **The paperwork + CTA** | The 7 `LEGAL_DOCS` from `lib/legal.ts:19` as small inline links (not the large buttons the gate uses), plus "You accepted these on {{date}}" — **requires exposing `acceptedAt` from `stores/consent.ts:43`**, which currently only exports `accepted`/`accept`. Primary CTA `<Link to="/">` "Start browsing"; secondary → `/about` | `lib/legal.ts:19-27` |

### 1.6 Component tree

```
web/src/pages/Welcome.tsx           export function WelcomePage()
└ <WelcomeShell>                    full-bleed, own scroll, env(safe-area-inset-*) padding
  │                                 copied from Layout.tsx:30-35 (Android edge-to-edge)
  ├ <WelcomeHero/>
  │   └ <LiveStats/>                useGames() → count + last_updated + <Skeleton/>
  ├ <WelcomeSection id="what">      3 bullets
  ├ <WelcomeSection id="caveats">   <CaveatList/> + external DISCLAIMER link
  ├ <WelcomeSection id="updates">   cadence + stamp + cache note
  ├ <EntryGrid/>                    4× <EntryCard to icon titleKey bodyKey/> + <CommandHint/>
  ├ <PreferencesRow/>               <LanguageToggle/> + <ThemeToggle/>
  ├ <LegalStrip/>                   LEGAL_DOCS links + accepted-on line
  └ <WelcomeFooter/>                primary CTA → "/", secondary → "/about"
```

**New files:** `pages/Welcome.tsx`, `stores/welcome.ts`, `stores/theme.ts`, `components/common/WelcomeGate.tsx`, `components/common/LanguageToggle.tsx`, `components/common/ThemeToggle.tsx`.
`LanguageToggle`/`ThemeToggle` are extracted, not duplicated — they replace the 3-button block at `Topbar.tsx:159-187` and the language block at `Settings.tsx:68-97`.

**Files edited:** `App.tsx` (route + gate), `stores/consent.ts` (expose `acceptedAt`), `CommandPalette.tsx:48` (add Welcome), `pages/About.tsx` (link back), `pages/Settings.tsx` (reset button).

**Bundling:** import `WelcomePage` eagerly next to `Dashboard` in `App.tsx:3`. It is text + icons (~5 KB gz) and it is the first thing a new user sees after consent — a lazy chunk means a spinner at the worst possible moment. If bundle budget becomes an issue, use `lazyWithRetry` plus `void import("../../pages/Welcome")` prefetch in a `ConsentGate` mount effect.

### 1.7 `App.tsx` shape

```tsx
<Routes>
  <Route path="/welcome" element={<WelcomePage />} />          {/* chrome-less */}
  <Route element={<Layout />}>
    <Route index element={<WelcomeGate><Dashboard /></WelcomeGate>} />
    …
    {/* legacy paths kept alive across the HashRouter → BrowserRouter + IA moves */}
    <Route path="top-online"  element={<Navigate to="/leaderboards/online"  replace />} />
    <Route path="top-offline" element={<Navigate to="/leaderboards/offline" replace />} />
    <Route path="charts/anti-cheat/list" element={<Navigate to="/charts/anti-cheat?view=list" replace />} />
  </Route>
</Routes>
```

### 1.8 i18n keys to add

`web/src/i18n/locales/en.json` — new top-level `welcome` block:

```json
"welcome": {
  "title": "Steam F2P Tracker",
  "tagline": "A hand-kept list of every free-to-play game on Steam, refreshed by a robot every day.",
  "statGames": "games tracked",
  "statUpdated": "last refreshed",
  "statSource": "open data",
  "whatTitle": "What this is",
  "whatB1": "A curated catalogue of free-to-play Steam games with players, reviews, genres, platforms, languages, anti-cheat and DRM notes.",
  "whatB2": "Maintained by one person as a hobby project. Not a Valve or Steam product, and not affiliated with them.",
  "whatB3": "Everything is public: the data lives as plain JSONL in a Git repository you can read, fork, or download.",
  "caveatsTitle": "Read this before you trust a number",
  "caveatsIntro": "The project is provided \"as is\", with no warranty of any kind.",
  "caveat1": "Not complete and not always accurate. Games flip to paid, get delisted, or disappear. Check the Steam page before you decide anything.",
  "caveat2": "Genre is a best guess. One genre per game, picked from Steam tags and description text — hybrids get filed under whichever bucket won. Use the tag list when accuracy matters.",
  "caveat3": "Player counts are samples, not live. They come from periodic Steam API calls and can lag by minutes to hours.",
  "caveat4": "The \"safe\" flag is one person's opinion, not an antivirus verdict. Scan things yourself.",
  "caveatsLink": "Read the full disclaimer",
  "updatesTitle": "How often it updates",
  "updatesBody": "A scheduled pipeline re-reads Steam once a day and commits what changed; the maintainer also edits by hand. There is no uptime or freshness guarantee — this is a hobby, not a service.",
  "updatesStamp": "This copy of the data is from {{date}}.",
  "updatesCache": "The app stores the dataset in your browser so it opens instantly and still works offline; it re-checks for a newer version on every visit.",
  "startTitle": "Where to start",
  "entryGamesTitle": "Browse the catalogue",
  "entryGamesBody": "All {{count}} games, filterable by genre, platform, language, anti-cheat and more.",
  "entryLeaderboardsTitle": "Leaderboards",
  "entryLeaderboardsBody": "Who is being played right now, and who has nobody left.",
  "entryChartsTitle": "Charts",
  "entryChartsBody": "Genres, platforms, review scores, release years, anti-cheat and DRM at a glance.",
  "entryHealthTitle": "Data health",
  "entryHealthBody": "What is missing, stale, or contradictory in the dataset — checked in the open.",
  "searchHintKeyboard": "Press ⌘K anywhere to jump to a game, a page, or a chart.",
  "searchHintTouch": "Tap the search button in the header to jump to a game, a page, or a chart.",
  "prefsTitle": "Language and appearance",
  "prefsHint": "You can change these later in Settings.",
  "legalTitle": "The paperwork",
  "legalBody": "You accepted these documents on {{date}}. They are still one click away.",
  "cta": "Start browsing",
  "ctaSecondary": "More about the project",
  "revisitHint": "You can reopen this page any time from About or the command palette.",
  "showAgain": "Show the welcome page again",
  "showAgainDone": "It will show the next time you open the app."
}
```

`web/src/i18n/locales/vi.json` — matching block, in the existing informal register that keeps English loanwords (`repo`, `game`, `tag`):

```json
"welcome": {
  "title": "Steam F2P Tracker",
  "tagline": "Danh sách game miễn phí trên Steam, do một người tổng hợp và robot cập nhật mỗi ngày.",
  "statGames": "game đang track",
  "statUpdated": "cập nhật lần cuối",
  "statSource": "dữ liệu mở",
  "whatTitle": "Đây là cái gì",
  "whatB1": "Danh mục game free-to-play trên Steam kèm số người chơi, đánh giá, thể loại, nền tảng, ngôn ngữ, anti-cheat và ghi chú DRM.",
  "whatB2": "Một người làm cho vui, bảo trì lúc rảnh. Không phải sản phẩm của Valve/Steam và không liên kết với họ.",
  "whatB3": "Mọi thứ đều công khai: dữ liệu là file JSONL nằm trong repo Git, bạn đọc, fork hay tải về đều được.",
  "caveatsTitle": "Đọc cái này trước khi tin vào một con số",
  "caveatsIntro": "Dự án được cung cấp \"nguyên trạng\" (as is), không bảo hành dưới bất kỳ hình thức nào.",
  "caveat1": "Không đầy đủ và không phải lúc nào cũng chính xác. Game có thể đổi sang trả phí, bị gỡ, hoặc biến mất. Hãy mở trang Steam kiểm tra lại.",
  "caveat2": "Thể loại chỉ là phỏng đoán. Mỗi game một thể loại, lấy từ tag Steam và mô tả — game lai thì rơi vào nhóm nào thắng thì chịu. Cần chính xác thì xem danh sách tag.",
  "caveat3": "Số người chơi là mẫu lấy theo chu kỳ, không realtime. Lấy từ Steam API định kỳ nên có thể trễ vài phút tới vài giờ.",
  "caveat4": "Cột \"safe\" là ý kiến cá nhân của người bảo trì, không phải kết quả quét virus. Tự quét lấy nhé.",
  "caveatsLink": "Đọc toàn văn Disclaimer",
  "updatesTitle": "Cập nhật bao lâu một lần",
  "updatesBody": "Pipeline chạy theo lịch, mỗi ngày đọc lại Steam một lần rồi commit phần thay đổi; ngoài ra người bảo trì cũng sửa tay. Không cam kết uptime hay độ mới — đây là dự án cá nhân, không phải dịch vụ.",
  "updatesStamp": "Bản dữ liệu bạn đang xem là từ {{date}}.",
  "updatesCache": "App lưu dữ liệu ngay trong trình duyệt để mở nhanh và vẫn dùng được khi mất mạng; mỗi lần vào lại sẽ kiểm tra bản mới.",
  "startTitle": "Bắt đầu từ đâu",
  "entryGamesTitle": "Xem toàn bộ danh sách",
  "entryGamesBody": "Tất cả {{count}} game, lọc theo thể loại, nền tảng, ngôn ngữ, anti-cheat và nhiều thứ khác.",
  "entryLeaderboardsTitle": "Bảng xếp hạng",
  "entryLeaderboardsBody": "Game nào đang được chơi nhiều nhất, và game nào không còn ai.",
  "entryChartsTitle": "Biểu đồ",
  "entryChartsBody": "Thể loại, nền tảng, điểm đánh giá, năm phát hành, anti-cheat và DRM trong một cái nhìn.",
  "entryHealthTitle": "Sức khoẻ dữ liệu",
  "entryHealthBody": "Chỗ nào thiếu, cũ hoặc mâu thuẫn trong dữ liệu — kiểm tra công khai.",
  "searchHintKeyboard": "Bấm ⌘K ở bất kỳ đâu để nhảy tới một game, một trang hay một biểu đồ.",
  "searchHintTouch": "Chạm nút tìm kiếm trên thanh trên cùng để nhảy tới một game, một trang hay một biểu đồ.",
  "prefsTitle": "Ngôn ngữ và giao diện",
  "prefsHint": "Bạn có thể đổi lại trong Cài đặt.",
  "legalTitle": "Phần giấy tờ",
  "legalBody": "Bạn đã chấp nhận các văn bản này vào {{date}}. Bấm là mở lại được.",
  "cta": "Bắt đầu xem",
  "ctaSecondary": "Tìm hiểu thêm về dự án",
  "revisitHint": "Bạn có thể mở lại trang này bất cứ lúc nào từ Giới thiệu hoặc command palette.",
  "showAgain": "Hiện lại trang chào mừng",
  "showAgainDone": "Lần mở app tới sẽ hiện lại."
}
```

Plus additions to the existing `nav` block (both files):

| key | en | vi |
|---|---|---|
| `nav.welcome` | Welcome | Chào mừng |
| `nav.browse` | Browse | Duyệt |
| `nav.leaderboards` | Leaderboards | Bảng xếp hạng |
| `nav.insights` | Insights | Phân tích |
| `nav.system` | System | Hệ thống |
| `nav.chartsOverview` | All charts | Tất cả biểu đồ |
| `nav.online` | Online now | Đang online |
| `nav.offline` | Least played | Ít người chơi |

And a new `a11y` block: `a11y.skipToContent`, `a11y.mainNavigation`, `a11y.themeGroup`, `a11y.languageGroup`, `a11y.chartLabel`.

**`{{count}}` note:** `welcome.entryGamesBody`, `topbar.gamesCount`, `dashboard.subtitle` all interpolate a count. Under i18next 24+ (you are going to 26) real English pluralization needs `_one`/`_other` suffixed keys. Vietnamese has one plural form and is unaffected. Add `entryGamesBody_one`/`_other` and `gamesCount_one`/`_other` to `en.json` during the i18next upgrade — today a single key means `1 games`.

---

## 2. Visual refresh — the token set

### 2.1 Direction

Name it: **Cold Neon**. A cool blue-grey ground with a **cyan-teal primary** and a **violet secondary**. Rationale, not taste:

- `--primary: 217.2 91.2% 59.8%` (`index.css:11,32`) is Tailwind `blue-500`. It collides with Steam's own blue, with the "info" semantic, and with `#3b82f6`/`#60a5fa` already used as a *data series* colour (`PlatformsDonut.tsx:11`, `AddedCumulativeLine.tsx:46`). Moving the primary to cyan frees blue for data.
- The current palette is untouched shadcn slate/blue — the "generic" complaint is literally correct: `index.css:7-45` is the default `npx shadcn init` output.
- The identical `--primary` in both light and dark (`:11` vs `:32`) is why light mode looks unfinished: a colour that passes on `#0e1116` cannot pass on white.

### 2.2 Colour tokens (raw HSL channels, keeping the existing indirection)

**Light** — `:root`

| Token | Value | Notes |
|---|---|---|
| `--background` | `220 30% 98%` | |
| `--foreground` | `222 40% 12%` | ≈15:1 on background |
| `--card` | `0 0% 100%` | |
| `--card-foreground` | `222 40% 12%` | |
| `--surface-2` | `220 24% 96%` | new — nested panels, table stripes |
| `--popover` / `--popover-foreground` | `0 0% 100%` / `222 40% 12%` | new — currently popovers borrow `--card` |
| `--primary` | `190 90% 29%` | white-on-primary = **5.3:1** |
| `--primary-foreground` | `0 0% 100%` | |
| `--secondary` | `258 62% 48%` | violet; was slate-100, an unused non-colour |
| `--secondary-foreground` | `0 0% 100%` | |
| `--muted` | `220 24% 94%` | |
| `--muted-foreground` | `220 12% 40%` | **5.9:1** on white |
| `--accent` / `--accent-foreground` | `220 24% 94%` / `222 40% 12%` | hover fills |
| `--destructive` | `351 66% 44%` | |
| `--success` | `152 62% 30%` | new — replaces `emerald-500` literals |
| `--warning` | `32 90% 38%` | new — replaces `amber-*` literals |
| `--info` | `214 80% 42%` | new |
| `--border` | `220 16% 88%` | |
| `--border-strong` | `220 14% 78%` | new — 3:1 for input outlines |
| `--input` | `220 16% 84%` | |
| `--ring` | `190 90% 34%` | |
| `--shadow-color` | `220 30% 30%` | new |

**Dark** — `.dark`

| Token | Value | Notes |
|---|---|---|
| `--background` | `222 24% 7%` | |
| `--foreground` | `210 20% 96%` | |
| `--card` | `222 20% 10%` | |
| `--surface-2` | `222 18% 13%` | |
| `--popover` | `222 18% 13%` | |
| `--primary` | `187 82% 46%` | **8.5:1** as text on background; dark text on it = 8.4:1 |
| `--primary-foreground` | `200 60% 8%` | |
| `--secondary` | `258 70% 66%` | |
| `--secondary-foreground` | `258 40% 10%` | |
| `--muted` | `222 16% 15%` | |
| `--muted-foreground` | `217 12% 65%` | **6.6:1** on card |
| `--accent` / `--accent-foreground` | `220 16% 18%` / `210 20% 96%` | |
| `--destructive` | `351 74% 56%` | |
| `--success` | `152 58% 45%` | |
| `--warning` | `38 92% 55%` | |
| `--info` | `214 90% 62%` | |
| `--border` | `220 14% 20%` | |
| `--border-strong` | `220 14% 28%` | |
| `--input` | `220 14% 24%` | |
| `--ring` | `187 82% 55%` | |
| `--shadow-color` | `222 40% 3%` | |

**Chart series** — 8 hues, defined per theme so charts work in both modes:

| Token | Dark | Light |
|---|---|---|
| `--chart-1` cyan | `187 82% 52%` | `190 88% 34%` |
| `--chart-2` violet | `258 70% 68%` | `258 62% 50%` |
| `--chart-3` green | `152 58% 50%` | `152 62% 32%` |
| `--chart-4` amber | `38 92% 58%` | `32 90% 40%` |
| `--chart-5` rose | `351 74% 62%` | `351 66% 46%` |
| `--chart-6` blue | `214 90% 65%` | `214 80% 44%` |
| `--chart-7` magenta | `315 65% 62%` | `315 60% 42%` |
| `--chart-8` teal | `172 45% 45%` | `174 55% 28%` |

Adjacent pairs are ≥30° apart in hue and ≥12% apart in lightness, so a 6-series stack stays distinguishable in greyscale and for deuteranopia. Semantic mappings for the charts that encode meaning: kernel AC → `--destructive`, userland AC → `--warning`, none → `--success` (`AntiCheatStacked.tsx:54,61,68`).

### 2.3 Type scale

Keep Tailwind's default sizes (changing base 16px would reflow every table). Add:

- `--text-2xs: 0.6875rem / 1rem` — tokenizes the `text-[11px]` arbitrary at `Sidebar.tsx:127,138`.
- `--text-display: 2.25rem / 2.5rem`, `md:3rem / 1.1` — welcome hero only.
- `--font-sans: "InterVariable", system-ui, …` — **and actually load it.** Self-host the Inter variable subset from the Worker origin (`font-display: swap`, `unicode-range` covering Latin + Vietnamese; Inter has covered Vietnamese since v3). Self-hosting rather than Google Fonts keeps `docs/PRIVACY_POLICY.md`'s "no third parties" claim true after the migration. Alternative if you don't want the 90 KB: delete `Inter` from the stack and own `system-ui` honestly.
- `--font-mono: "JetBrains Mono", ui-monospace, …` — same: it is declared at `tailwind.config.ts:52` and never loaded. Either load it or drop it to `ui-monospace`.
- **Tabular numerals.** `formatNumber()` (`lib/utils.ts:12`) output jitters in every table and KPI. Add a `.tnum { font-variant-numeric: tabular-nums }` utility and apply it on `columns.tsx` numeric cells, `KpiCards.tsx:139`, and the leaderboard value labels. Keep `"rlig" 1, "calt" 1` at `index.css:52`.
- **Vietnamese line-height.** `:where(:lang(vi)) { line-height: 1.6 }` on body copy, and drop `tracking-tight` for vi headings (`Dashboard.tsx:26`, `Settings.tsx:56`, `About.tsx:118`) — stacked diacritics collide at negative tracking. Implement as `:lang(vi) .font-display, :lang(vi) h1 { letter-spacing: 0 }`.

### 2.4 Spacing, radius, elevation

- `--radius: 0.625rem` (was `0.5rem` at `index.css:24`). Derived: `sm = r-4px`, `md = r-2px`, `lg = r`, `xl = r+4px`. **Cards move to `xl` (14px)**, buttons/inputs stay `md` (8px) — the uniform 8px-everything is a large part of the generic read.
- `--space-section: 1.5rem` — tokenizes the `space-y-6` used on every page shell (`Dashboard.tsx:24`, `Settings.tsx:54`, `About.tsx:116`).
- **Elevation, 3 levels.** Dark UIs communicate elevation with surface + border, not shadow:
  - `--shadow-1: 0 1px 2px hsl(var(--shadow-color)/.06)` — cards
  - `--shadow-2: 0 4px 12px -2px hsl(var(--shadow-color)/.10), 0 2px 4px -2px hsl(var(--shadow-color)/.06)` — popovers, dropdowns
  - `--shadow-3: 0 24px 48px -12px hsl(var(--shadow-color)/.45)` — sheets, dialogs, command palette
  - In dark mode, each level *also* steps `--card` → `--surface-2` and `--border` → `--border-strong`.

### 2.5 Motion policy

| Token | Value | Used for |
|---|---|---|
| `--duration-1` | `80ms` | hover, press, colour change |
| `--duration-2` | `140ms` | popover, tooltip, menu, cmdk |
| `--duration-3` | `220ms` | sheet, drawer, dialog |
| `--duration-4` | `320ms` | welcome hero entrance only |
| `--ease-out` | `cubic-bezier(.2,.8,.3,1)` | all enters |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | all exits |
| `--ease-spring` | `cubic-bezier(.34,1.3,.64,1)` | welcome hero only |

Rules: **only `opacity`, `transform`, and `background-color`/`border-color` may animate.** Never `height`/`width`/`top`/`left`. No route transitions (they fight the `<Suspense>` at `Layout.tsx:62`). ECharts gets `animationDuration: 300, animationEasing: "cubicOut"` — the default 1000ms staggered animation over 3,424 points is a measurable jank source on Android.

**Reduced motion — currently entirely absent from `index.css`.** Add to `@layer base`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

plus a `useReducedMotion()` hook feeding ECharts `animation: false` and disabling `.cmdk-shell`'s `slide-down` (`command-palette.css:23,127-130`).

### 2.6 The Tailwind 4 migration — `tailwind.config.ts` dissolves

**Fact: Tailwind 4 no longer auto-loads `tailwind.config.ts`.** Theme configuration moves into CSS via `@theme`. You *can* keep the JS file with `@config "../tailwind.config.ts";` — **don't**; it defeats the point and keeps a v3-shaped config alive.

Line-by-line disposition of `web/tailwind.config.ts`:

| Current | v4 fate |
|---|---|
| `:5` `darkMode: ["class"]` | → `@custom-variant dark (&:where(.dark, .dark *));` in CSS. **Required** — `Topbar.applyTheme` (`Topbar.tsx:19-28`) toggles `.dark`/`.light` on `<html>` |
| `:6` `content: [...]` | **Gone.** v4 auto-detects sources from the CSS entry's directory, respecting `.gitignore`. Anything outside `web/src` needs an explicit `@source` |
| `:8-12` `theme.container` | **Gone — hard break.** `Layout.tsx:41` uses `className="container max-w-screen-2xl py-6"` and will silently lose centring and padding. Replace with `mx-auto w-full max-w-screen-2xl px-4 py-6`, or define `@utility container { margin-inline: auto; padding-inline: 1rem; }` |
| `:14-44` `colors` | → `@theme inline` mapping `--color-*: hsl(var(--*))` |
| `:45-49` `borderRadius` | → `@theme { --radius-sm/md/lg/xl }` |
| `:50-53` `fontFamily` | → `@theme { --font-sans, --font-mono }` |
| `:2,56` `tailwindcss-animate` | **v3-only plugin — breaks.** Only 3 files use it: `ui/dialog.tsx:18,36`, `ui/popover.tsx:20-21`, `ui/sheet.tsx:17,41-43`. Either import `tw-animate-css`, or hand-write the 6 keyframes into `web/src/styles/animations.css` and drop the dependency (recommended — one fewer dependabot surface) |

`web/postcss.config.js` must change: `tailwindcss: {}` → `"@tailwindcss/postcss": {}`, and `autoprefixer` is dropped (v4 uses Lightning CSS). **Better:** delete `postcss.config.js` entirely and add `@tailwindcss/vite` to the plugin array in `web/vite.config.ts` — faster and it's the supported Vite path.

**New `web/src/index.css` skeleton:**

```css
@import "tailwindcss";
@import "./styles/animations.css";        /* replaces tailwindcss-animate */

@custom-variant dark (&:where(.dark, .dark *));

/* ---- raw channel tokens: light ---- */
:root {
  --background: 220 30% 98%;
  --foreground: 222 40% 12%;
  /* …the full table from §2.2… */
  --radius: 0.625rem;
}

/* ---- raw channel tokens: dark ---- */
.dark { /* …the dark table… */ }

/* ---- expose to Tailwind. `inline` is required so the /opacity modifier
       (bg-primary/15 at Sidebar.tsx:86) resolves via color-mix() ---- */
@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-surface-2: hsl(var(--surface-2));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-success: hsl(var(--success));
  --color-warning: hsl(var(--warning));
  --color-info: hsl(var(--info));
  --color-border: hsl(var(--border));
  --color-border-strong: hsl(var(--border-strong));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-chart-1: hsl(var(--chart-1));   /* …through chart-8 */

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  --font-sans: "InterVariable", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: 1rem;

  --shadow-1: 0 1px 2px hsl(var(--shadow-color)/.06);
  --shadow-2: 0 4px 12px -2px hsl(var(--shadow-color)/.10), 0 2px 4px -2px hsl(var(--shadow-color)/.06);
  --shadow-3: 0 24px 48px -12px hsl(var(--shadow-color)/.45);

  --ease-out: cubic-bezier(.2,.8,.3,1);
  --ease-in:  cubic-bezier(.4,0,1,1);
}

@layer base {
  /* KEEP — v4 changed the default border colour from gray-200 to currentColor.
     Without this every `border` class turns text-coloured. (was index.css:47-49) */
  *, ::before, ::after { border-color: var(--color-border); }

  body {
    background: var(--color-background);
    color: var(--color-foreground);
    font-feature-settings: "rlig" 1, "calt" 1;
  }

  /* ONE focus policy for the whole app */
  :focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }

  :where(:lang(vi)) { line-height: 1.6; }

  @media (prefers-reduced-motion: reduce) { /* …§2.5 block… */ }

  ::-webkit-scrollbar { height: .5rem; width: .5rem }
  ::-webkit-scrollbar-track { background: transparent }
  ::-webkit-scrollbar-thumb { border-radius: 9999px; background: var(--color-muted) }
}

@utility tnum { font-variant-numeric: tabular-nums; }
```

**v3→v4 renamed utilities that appear in this codebase** (the `npx @tailwindcss/upgrade` codemod handles most; verify each):

| Old | New | Sites |
|---|---|---|
| `shadow-sm` | `shadow-xs` | `card.tsx:9`, `input.tsx:11`, `textarea.tsx:11` |
| `rounded-sm` | `rounded-xs` | `dialog.tsx:43`, `sheet.tsx:49` |
| `outline-none` | `outline-hidden` | `popover.tsx:19`, `sheet.tsx:39`, `button.tsx:7`, `input.tsx:11`, `textarea.tsx:11`, `dialog.tsx:43` |
| bare `ring` | `ring-3` (v4 `ring` = 1px) | audit; `button.tsx:7` uses explicit `ring-2`, safe |

Still valid in v4, no change needed: `text-[11px]`, `h-[calc(100vh-260px)]`, `[&::-webkit-scrollbar]:hidden` (`MobileGameCards.tsx:33`), `supports-[backdrop-filter]:bg-background/70` (`Topbar.tsx:68`).

**Browser floor:** v4 requires Safari 16.4+ / Chrome 111+ / Firefox 128+ because of `@property` and `color-mix()`. Verify the Android `minSdkVersion` in the Tauri Android project — a device on an un-updated System WebView below 111 will render colours as transparent with no error. State a hard floor of WebView 111 in `docs/android-support.md`.

---

## 3. Information architecture

### 3.1 The problem, quantified

`Sidebar.tsx` renders **21 links** in a `w-60` rail: 4 primary (`:37-42`), 11 charts (`:44-56`), 6 secondary (`:62-69`). Two icon collisions (`Trophy` at `:40,:41`; `Shield` at `:49,:50`). The charts group alone is longer than the rest of the app.

### 3.2 New IA

```
BROWSE                                      always visible
  Dashboard         /                       end
  Games             /games
  Leaderboards      /leaderboards           ← NEW parent, segmented tabs inside
      online        /leaderboards/online      (← /top-online)
      offline       /leaderboards/offline     (← /top-offline)

INSIGHTS                                    collapsible <details>, default open ≥lg,
  All charts        /charts                 state in f2p:nav_groups
  Genres · Platforms · Languages · Tags · Reviews · Players
  · Time · DRM & DLC · Delisted · Anti-cheat            (10 items)

SYSTEM                                      compact icon row in the sidebar footer
  Health · Activity · About · Settings · [Add — owner only] · Donate
```

**21 → 3 always-visible + 10 collapsible + 6 in a footer row.**

Five specific moves:

1. **`/charts/anti-cheat/list` stops being a nav item** (`Sidebar.tsx:50`). It becomes a `chart | table` tab inside `/charts/anti-cheat`, driven by `?view=`. Kills the duplicate Shield icon and the confusing "Anti-Cheat" vs "AC Index" label pair.
2. **`/top-online` + `/top-offline` merge into `/leaderboards`** with a segmented control. Both old paths become `<Navigate replace>` so existing hash links survive the BrowserRouter switch.
3. **`/charts` becomes a real overview page.** Today `App.tsx:86` is just `<Navigate to="/charts/genres">`. Replace with a grid of 11 cards — each a mini-preview, a title, and a one-line "what this answers". This is what makes collapsing the sidebar group safe, and it is a far better mobile entry than a 10-item list.
4. **`/donate` leaves the rail** — it goes to the footer cluster plus a single heart icon in the Topbar. It is not a destination.
5. **`/add` stays owner-gated** — `Sidebar.tsx:106` already filters on `useIsOwner()`.

### 3.3 Command palette becomes the power path

Edits to `web/src/components/common/CommandPalette.tsx`:

- **Translate it.** `NAV` at `:48-66` holds 17 hardcoded English labels. Change `label: string` → `i18n: string` resolved at render, and keep the English literal in `keywords` so a Vietnamese user can still type "dashboard".
- **Add the missing routes:** `/top-offline`, `/charts/delisted`, `/charts/anti-cheat/list`, `/donate`, `/welcome` — all absent from `NAV` today.
- **Add actions**, which is the real justification for shrinking the rail: `Toggle theme`, `Switch to English` / `Chuyển sang Tiếng Việt`, `Copy data timestamp`, `Export current view to CSV` (logic already in `table/ExportMenu.tsx`), `Open repository`, `Show welcome`. `Lock GPG key` already exists at `:171`.
- **Add a `Recent games` group** backed by a small `f2p:recent_appids` list (last 8 detail-drawer opens).
- **Fix the IME bug:** `:78` needs `if (e.isComposing) return;` before the `⌘K` check — Vietnamese telex composition currently swallows keystrokes into the palette.
- **Fix focus management:** `:121` is a raw `<div>` overlay with no focus trap and no focus restore. Wrap it in a Radix `Dialog` (Content + `VisuallyHidden` Title) or add explicit trap/restore.

### 3.4 Mobile

- **Add a bottom tab bar.** Today every navigation on a phone costs a hamburger tap (`Topbar.tsx:69-77` → `Sheet` at `Sidebar.tsx:190-194`). Add `<MobileTabBar>` in `Layout.tsx` beside `<MobileSidebar>`: 4 tabs — Games, Leaderboards, Insights, Search (`openCommandPalette()`). `lg:hidden`, 56px, `pb-[env(safe-area-inset-bottom)]` — it sits naturally above the Android gesture inset the layout already handles (`Layout.tsx:23-35`). `<main>` gets `pb-14 lg:pb-0`.
- **Keep the Sheet** for the long tail (Health, Activity, About, Settings, Donate, Add).
- **Fix `MobileGameCards.tsx:33`:** `h-[calc(100vh-260px)]` is a magic number that already mis-sizes under Android safe-area insets and will break outright with a bottom bar. Use `100dvh` (so the collapsing mobile URL bar doesn't clip the last card) minus a `--chrome-h` custom property set once in `Layout`, or make it a `flex-1 min-h-0` child.
- **Touch targets:** the sidebar `Item` at `Sidebar.tsx:85` is `px-3 py-2` ≈ 36px. Add `min-h-11` (44px) below `lg`.
- **Add `<SheetTitle className="sr-only">`** to `MobileSidebar` (`Sidebar.tsx:191`) — Radix Dialog Content without a Title logs an a11y warning and gives AT users an unlabelled dialog.

---

## 4. Component-level changes

### 4.1 `web/src/components/ui/*` — all 10 files

| File | Work |
|---|---|
| `button.tsx` | Retoken variants; add `xs` (28px, for table toolbars) and `icon-sm`; focus becomes `focus-visible:ring-[3px] ring-ring/50 outline-hidden`; `outline-none`→`outline-hidden` at `:7` |
| `card.tsx` | 5 forwardRef components → `rounded-xl`, `shadow-1`; add `variant="interactive"` (hover raises `--border` → `--border-strong`). **Six places hand-roll this today**: `About.tsx:268,373,431,465,500` and `ConsentGate.tsx:87` |
| `badge.tsx` | `:14-15` hardcode `emerald-500`/`amber-400` → `--success`/`--warning` tokens. Add `info`, `neutral`. This alone removes ~9 of the 21 hardcoded-colour class hits |
| `input.tsx`, `textarea.tsx` | Token focus ring, `shadow-xs`, add `aria-invalid:border-destructive` styling |
| `dialog.tsx` | **It is not a dialog.** `DialogContent` at `:35` is styled as a right-side drawer (`fixed right-0 top-0 h-full max-w-2xl border-l`). Split: `dialog.tsx` becomes a centred modal for confirmations; the edit/detail drawers move to `sheet.tsx` with `side="right"`. Also `:43` — the close button has `focus:outline-none` with *no* replacement ring: it is invisibly focused today |
| `sheet.tsx` | Same `focus:outline-none` bug at `:49`. Add `side="bottom"` (needed for mobile filters) and export `SheetTitle`/`SheetDescription` |
| `label.tsx` | `:12` bakes `uppercase tracking-wider text-muted-foreground` into the primitive — a styling decision in the wrong layer. Make that `variant="overline"`; default to plain |
| `popover.tsx` | Use `--popover` tokens instead of borrowing `--card`; `outline-none`→`outline-hidden` at `:19` |
| `separator.tsx` | Token only |

**New primitives the rework needs** (all currently hand-rolled or missing): `tabs.tsx` (leaderboards, anti-cheat, and the existing hand-rolled `games/edit/ViewToggle.tsx`), `tooltip.tsx` (`Topbar.tsx:111,125,137` and many others use `title=`, which is inaccessible on touch and unreadable by most AT), `skeleton.tsx` (welcome + dashboard need real skeletons, not the full-page `LoadingState`), `select.tsx` (rows-per-page is currently a popover), `checkbox.tsx` (`ConsentGate.tsx:97` is a raw input with `accent-primary`), `switch.tsx`.

### 4.2 ECharts theme

The fix, in order:

1. **New `web/src/lib/echarts-theme.ts`** exporting `registerF2pThemes()`. It reads the CSS custom properties off `document.documentElement` via `getComputedStyle` at call time, then calls `echarts.registerTheme("f2p-light", {…})` and `("f2p-dark", {…})`. The theme object sets `color: [chart-1 … chart-8]`, `backgroundColor: "transparent"`, `textStyle.color = --foreground`, `axisLine`/`axisTick`/`splitLine` from `--border`, `tooltip` background `--popover` + border `--border`, `legend.textStyle` `--muted-foreground`.
2. **`EChart.tsx:101`** — `theme={resolved === "dark" ? "f2p-dark" : "f2p-light"}` from the new `useTheme()` store. Because the wrapper re-initialises when `theme` changes, charts re-theme on toggle for free.
3. **Delete all ~45 hardcoded hex values** in `components/charts/*.tsx`. Most `itemStyle.color` assignments should simply be *removed* so `theme.color[i]` applies. The ones that encode meaning get semantic vars via a `cssVar("--chart-1")` helper: `AntiCheatStacked.tsx:54,61,68`, `DrmDlcBars.tsx:41-44`, `PlayerTiersPie.tsx:12-16`, `DelistedReasonBreakdown.tsx:10-12`, `ReviewsHistogram.tsx:14-15`, `PlatformsDonut.tsx:11-14`, `TopOnlineBar.tsx:57`/`TopOfflineBar.tsx:60` (`tierColor`).
4. **The `#0f172a` borders are "the page background"** (`GenreTreemap.tsx:40,44`, `PlatformsDonut.tsx:51`, `PlayerTiersPie.tsx:50`, `LanguagesHeatmap.tsx:76`, `DelistedReasonBreakdown.tsx:41`). They must become `--card` or they paint dark seams on a white card in light mode. This is the single biggest reason light mode currently looks broken.
5. **`EChart.tsx:91`** hardcodes `fontFamily: "Inter, system-ui, sans-serif"` — read the token instead.
6. Add `animation: !prefersReducedMotion, animationDuration: 300, animationEasing: "cubicOut"`.
7. **`TagsWordCloud.tsx:45` calls `Math.random()` in the render path** — the cloud reshuffles colours on every re-render, and under React 19 StrictMode it will differ between the two dev renders. Replace with a deterministic hash of the word → index into the chart palette.

### 4.3 Theme switching, done properly

Current bugs, all in `Topbar.tsx:19-52`:

- `:45` initialises from localStorage at **Topbar mount** — `ConsentGate` has already painted, and `index.html:2` hardcodes `class="dark"`, so light-mode users get a dark flash on every load.
- `:23-26` reads `matchMedia` **once**. Changing the OS theme while the app is open does nothing until reload — `system` is broken as a feature.
- `:49-52` **writes** `f2p:theme` in a mount effect, so a user who never chose a theme gets `"dark"` persisted on first visit. Under React 19 StrictMode it writes twice.
- `main.tsx:36` hardcodes `<Toaster theme="dark">`.
- `index.html:7` `<meta name="theme-color" content="#0f172a">` is fixed — the Android/PWA status bar stays dark in light mode.
- The three buttons at `:159-187` signal selection only via `text-foreground` vs `text-muted-foreground` — roughly a 2:1 visual delta, and nothing is announced to AT.

The fix:

1. **`web/src/stores/theme.ts`** (zustand, same shape as `stores/consent.ts`): `{ mode: "light"|"dark"|"system", resolved: "light"|"dark", setMode }`, persisted to the **existing `f2p:theme` key** with the same three string values — don't orphan current users.
2. **A blocking inline script in `index.html`, before `<div id="root">`** (~10 lines): read `f2p:theme`, resolve `system` via `matchMedia`, set `documentElement.classList` + `data-theme` + the `theme-color` meta content. **Remove `class="dark"` from `index.html:2`.** This is the only way to kill the FOUC. It must be inline — add its `sha256-` to both the new Tauri CSP and the Worker's CSP header; coordinate with the security workstream, since `tauri.conf.json` currently has `security.csp: null`.
3. `matchMedia("(prefers-color-scheme: dark)").addEventListener("change", …)` inside the store, live only while `mode === "system"`.
4. **`<ThemeToggle/>`** — one segmented control with `role="radiogroup"` and `aria-checked`, replacing `Topbar.tsx:159-187`. Reused on the welcome page.
5. `<Toaster theme={resolved}>` at `main.tsx:36`, and re-verify the inline `style` override at `:38-44` against the new tokens.
6. Same store drives `EChart` and the `theme-color` meta.
7. **Tauri:** set `windows[].theme: null` (follow system) so the native chrome matches. Separately — `tauri.conf.json` pins a **non-resizable 1400×900 window**, which means the desktop shell is permanently in the `≥lg` branch and users who need browser zoom can't compensate. Recommend `resizable: true, minWidth: 960, minHeight: 600`.

---

## 5. Accessibility + i18n

### 5.1 Contrast targets

- Body text ≥ **7:1** (AAA) on `--background`; secondary text ≥ **4.5:1**; non-text UI (input borders, focus ring, chart series against card) ≥ **3:1**. The §2.2 values are chosen to hit these — see the per-token notes.
- **Current failures to fix:** `text-emerald-300` on `bg-emerald-500/10` (`Topbar.tsx:126`) and the amber-on-amber-tint pattern (`ConsentGate.tsx:55-58`, `About.tsx:294-296`) sit near 3:1 for small text. Replaced by `--success`/`--warning` at the values above.
- `disabled:opacity-50` (`button.tsx:7`) drops a 7:1 label to ~3.5:1. WCAG 1.4.3 exempts disabled controls, but prefer swapping to `--muted-foreground` over multiplying opacity.

### 5.2 Focus

One policy: `:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px }` in `@layer base`. Component-level `focus-visible:ring-*` only where an outline is clipped by `overflow-hidden`.

Remove every bare `focus:outline-none` that has no replacement: **`dialog.tsx:43`** and **`sheet.tsx:49`** (both close buttons). `command-palette.css:45` `outline: 0` on `.cmdk-input` is acceptable (it is the only focusable element in that region) but the `[data-selected]` background at `command-palette.css:92-96` must clear 3:1 against `--card`.

### 5.3 Keyboard paths — write these as acceptance tests

1. **Skip link — does not exist today.** Add `<a href="#main" class="sr-only focus:not-sr-only …">` as the first child of `Layout`; give `<main>` `id="main"` and `tabIndex={-1}`; focus `mainRef.current` on route change so SPA navigation is announced. The ref already exists at `Layout.tsx:21,40`.
2. Tab order from load: skip link → hamburger → search → theme → main.
3. `⌘K`/`Ctrl+K` from anywhere (`CommandPalette.tsx:78`) — **plus the `e.isComposing` guard** (Vietnamese IME).
4. Escape closes palette/sheet/dialog and returns focus to the trigger. Radix does this; the hand-rolled palette overlay (`CommandPalette.tsx:121`) does not — fix per §3.3.
5. Welcome page: strict top→bottom order, CTA last, all four entry cards are `<Link>`, never `<div onClick>`.
6. **Charts are invisible to AT.** Minimum: `role="img"` + a generated `aria-label` on each `<EChart>`, and for the four dashboard charts a `<details>` "view as table" alternate. Full table alternates for all 11 is a separate scope item.

### 5.4 `lang` and i18n

- **`index.html:2` hardcodes `lang="vi"`.** `i18n/index.ts:86-89` already corrects it after init, but (a) between HTML parse and init the document claims `vi` for an English user, and AT reads the initial value; (b) crawlers see `vi` on a page whose bundled fallback is `en`. Fix: set `lang="en"` as the neutral default **and** move the assignment into the same inline bootstrap script that handles the theme (read `f2p:lang` → `documentElement.lang`), so it is correct before first paint. Keep the `languageChanged` listener at `:87-89`.
- `<meta property="og:locale" content="vi_VN">` (`index.html:36`) — flip to `en_US` primary with `vi_VN` alternate, or let the Worker rewrite it per `Accept-Language`. Stop asserting `vi`.
- Add explicit `dir="ltr"` and use logical utilities (`ps-*`, `pe-*`, `ms-auto`) in all new components — Tailwind 4 ships `start`/`end` variants, so a future RTL locale becomes a config change.
- **Un-translated strings found, to fix in this pass:** `KpiCards.tsx:69-118` (7 labels + hints), `CommandPalette.tsx:49-65` (17 labels), and the entire body of `About.tsx` (`:136-141, 178-209, 220-245, 256-259, 356-366, 449-459, 491-495, 534-542`) — English prose inside a translated page shell. The welcome page re-uses the About "heads-up" bullets, so extract those at minimum.

---

## 6. React 19 + Tailwind 4 risks specific to this codebase

### 6.1 React 19

1. **`forwardRef` is not removed — don't rush the codemod.** All 14 `React.forwardRef` sites (`button.tsx:35`; `card.tsx:4,18,26,38,46,54`; `dialog.tsx:11,26,63,75`; `input.tsx:6`; `label.tsx:5`; `popover.tsx:9`; `separator.tsx:5`; `sheet.tsx:10,30`; `textarea.tsx:6`) keep working in 19. The real break is typing: **`React.ElementRef<typeof X>` is deprecated in `@types/react` 19 → `React.ComponentRef<typeof X>`**. That type appears at `dialog.tsx:12,27,64,76`; `label.tsx:6`; `popover.tsx:10`; `separator.tsx:6`; `sheet.tsx:11,31`. Fix all nine or `tsc -b` fails.
2. **`@types/react` 19 tightened globals:** `JSX.Element` → `React.JSX.Element`; `ReactNode` no longer includes `{}`; **`useRef` now requires an initial argument**. `Layout.tsx:21` already passes `null` — grep `useRef<` across `src` for the rest.
3. React 19 removed `ReactDOM.render`/`hydrate`, `unmountComponentAtNode`, string refs, `defaultProps` on function components, legacy context, and `propTypes`. `main.tsx:25` already uses `createRoot`, so app code is clean — the risk is inside `echarts-for-react`, the oldest dep here.
4. **StrictMode double-invoke.** React 19 keeps the double render/effect *and* adds double-invocation of `useMemo`/`useState` initializers to catch impurity. Three concrete hazards:
   - **`TagsWordCloud.tsx:45`** — `Math.random()` in the render path. Genuinely impure; will now differ across the two dev renders. Same fix as §4.2.7.
   - **`Topbar.tsx:49-52`** — a mount effect that *writes* localStorage. Fires twice and persists `"dark"` for users who never chose. Resolved by moving to the theme store + inline bootstrap (§4.3).
   - **`Welcome`'s `markSeen()`** — an idempotent single write; safe under double-effect. Note it in the code so nobody "fixes" it with a ref guard.
   - Audit `useGpgAutolock` and `useAndroidUpdateCheck` (`Layout.tsx:16-17`) — any timer/interval without cleanup will double-fire.

### 6.2 Peer compatibility, dependency by dependency

| Dep | Installed | React 19 status | Action |
|---|---|---|---|
| `@radix-ui/react-{dialog,label,popover,separator,slot}` | 1.1.x / 2.1.x | OK since 1.1.x (peers widened to `^19`) | Bump all five. **`react-slot` matters most** — `button.tsx:37` uses `asChild`; an old Slot + React 19 can drop refs |
| `cmdk` | `^1.0.0` | 1.0.x had React-19 peer conflicts; **1.1.x** declares `react ^18 \|\| ^19` | **Must bump.** cmdk also pulls Radix internally, so a stale cmdk drags an old `@radix-ui/react-dialog` into the tree |
| `sonner` | `^1.5.0` | 1.5 predates 19; **2.x** supports it | Bump. The `theme` / `toastOptions.style` API used at `main.tsx:33-45` is unchanged, but `richColors` styling shifted — re-verify against the new tokens |
| `echarts-for-react` | `^3.0.2` | **Peer is `react ^15\|\|^16\|\|^17\|\|^18` — no React-19 range shipped.** `npm ci` will error | **Drop it.** The wrapper is ~120 lines using only `useEffect`/`useRef`/`createElement`. Replace with a direct `echarts.init` + `ResizeObserver` inside `EChart.tsx` (~40 lines). This also removes the `esm/core` import hack documented at `EChart.tsx:19-23` and gives direct `setOption(opt, {notMerge, lazyUpdate})` / `dispose()` control |
| `echarts` | manifest `^6.1.0`, **lockfile pinned 5.6.0** | — | Sync 5→6 in the same PR (you're writing a custom theme anyway). **Risk: `echarts-wordcloud@2.1.0` declares echarts `^5`** — verify it runs on 6 or `/charts/tags` breaks. This is the one genuine blocker in the chart stack |
| `zustand` | `^4.5.5` | v4's `use-sync-external-store` shim conflicts under 19 | **Bump to 5.** v5 drops the default export and deprecated `create` overloads. `stores/consent.ts:43` uses the v5-compatible `create<T>((set)=>…)` form; check `stores/auth.ts` for `persist` middleware, which needs `create<T>()(persist(…))` |
| `i18next` | 23 → **26** | — | `t()` key inference tightens; `compatibilityJSON: 'v3'` plurals are gone. **`{{count}}` keys need `_one`/`_other` in `en.json`** (`topbar.gamesCount`, `dashboard.subtitle`, new `welcome.entryGamesBody`). Vietnamese has one plural form — unaffected |
| `react-i18next` | `^15.0.3` | React 19 OK | Bump minor |
| `@tanstack/react-query` 5, `@tanstack/react-virtual` 3 | | Both React-19 ready | Bump minor |
| `lucide-react` | `^0.452.0` | peers already allow 19 | Bump |
| `react-router-dom` | `6.30.4` → **7** | — | Package renames to `react-router`; `-dom` is a shim. This is where `HashRouter` → `BrowserRouter` lands (`main.tsx:29`). **Clears two open Dependabot alerts** (open-redirect→XSS; `deserializeErrors` constructor injection) |

### 6.3 Tailwind 4 risks specific here

Recapping the hard breaks from §2.6, in priority order:

1. **`container` at `Layout.tsx:41`** — the utility's `center`/`padding`/`screens` config no longer exists. Silent layout break on every page.
2. **`tailwindcss-animate`** — v3-only. Breaks `ui/dialog.tsx:18,36`, `ui/popover.tsx:20-21`, `ui/sheet.tsx:17,41-43`.
3. **`postcss.config.js`** — must change or the build produces no CSS at all.
4. **Default border colour** changed `gray-200` → `currentColor`. The `* { @apply border-border }` at `index.css:47-49` masks it; keep its v4 equivalent or every `border` class turns text-coloured.
5. **`bg-primary/15`** (`Sidebar.tsx:86,110`) and every other `/opacity` modifier requires the theme colour to be a real colour function — hence `@theme inline` with `hsl(var(--x))`, which compiles to `color-mix()`. Ties back to the WebView-111 floor.
6. `space-y-*` implementation changed (`:not([hidden])~:not([hidden])` → `:not(:last-child)`). Heavily used; low risk, but check `GameDetailDrawer.tsx` which is the only `space-x-` user.

### 6.4 Order of operations — do not do this in one commit

1. `@types/react` → 19 (types only, still on React 18): fix `ElementRef`→`ComponentRef` and `useRef` typing. Compiles clean, ships independently.
2. React 18→19 + react-dom + peer bumps (Radix, cmdk 1.1, sonner 2, zustand 5, lucide, react-i18next). Verify dev under StrictMode.
3. Replace `echarts-for-react` with a direct `echarts.init` wrapper; sync echarts 5→6; **verify `echarts-wordcloud` on 6**.
4. react-router 6→7 + `HashRouter`→`BrowserRouter` + a `#/path` → `/path` redirect shim (every existing GitHub-Pages link is a hash URL — either a `useEffect` in `main.tsx` or a rewrite in the Worker).
5. Tailwind 3→4 (`npx @tailwindcss/upgrade`), then fix `container`, the animate plugin, and postcss→`@tailwindcss/vite` by hand.
6. New token set + `index.css` rewrite + ECharts theme + component restyle + the inline theme/lang bootstrap script (**coordinate the CSP hash with the Tauri/Worker security work**).
7. IA rework + `/charts` overview + `/leaderboards` + welcome page + i18n additions.

Each step is independently shippable and revertable. Step 6 is the only one that changes every screen at once — land it behind a single commit so a revert is trivial.