# Accessibility

This file is about using this project with a keyboard, a screen reader, zoom,
high contrast or reduced motion, or with anything else that is not a mouse and
a default screen. It covers:

- the website, <https://free-steam-games.win/>;
- the desktop and Android apps, which are the same interface running in the
  system's web view;
- the data as plain text: [`data/`](data/) (JSONL), the CSV/JSON export on the
  Games page, and the Markdown leaderboards in [`games/`](games/).

It does not cover Steam's own pages, Cloudflare's Turnstile widget (the
website's human check) or GitHub itself. Those belong to Valve, Cloudflare and
GitHub.

One person maintains this as a hobby, and nobody has audited it. So this is not
a certificate. It is a list of what is known to work, what is known not to, and
how to say so when something gets in your way.

## The goal

**[WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA** is the target. It is a
target, not a claim: the app has not been audited against it, and the
limitations below mean it does not meet it today.

What matters most, in this order:

1. Finding and opening a game (search, filters, the games list, a game's page)
   with a keyboard, a screen reader or zoom.
2. Nothing said with colour alone, or only in a mouse-hover tooltip.
3. No traps, including the first-run screens every visitor has to get past.
4. The reader's own settings win: language, reduced motion, light or dark,
   zoom.

## What works today

Checked against the code on 2026-11-09 (website and apps 2.5.0).

- **Language.** The page declares its language, and changes it when you
  switch between English and Vietnamese.
- **Structure.** "Skip to content" is the first thing the keyboard reaches.
  The header and both navigation menus are labelled, and the menus mark the
  page you are on. Each page has one main heading and its own title, and
  moving to another page announces the new title.
- **Keyboard.** Links and controls show a focus ring (one exception, below).
  <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> opens a command palette that
  works like a search box with a list: arrow keys, <kbd>Enter</kbd>,
  <kbd>Esc</kbd>. The menu drawer on small screens, the palette and the
  desktop update dialog keep focus inside while they are open, close with
  <kbd>Esc</kbd>, and put focus back where it was.
- **Names.** Buttons that only show an icon have a text name. Switches (the
  language and theme buttons, the scrollbar options, the choices on *Random
  games*, the anti-cheat families) say whether they are on.
- **Charts.** Each chart is announced as an image named by its title. Some
  also give the numbers as text: *Top online* and *Top offline* list 100 games
  under their charts, *Genres* lists the top 24, *Tags* writes out 40 of its
  60 words with their counts, and the anti-cheat chart links to a real table
  that also says, in words, which anti-cheat runs at kernel level.
- **Images, sound and motion.** Game art is decorative (`alt=""`); the game's
  name is always written next to it. Nothing plays sound or video. With your
  system's *reduce motion* setting on, page animations and transitions are cut
  short and scrolling jumps instead of gliding.
- **Zoom and small screens.** The website never blocks pinch-zoom. Below
  tablet width the games table turns into cards, and a test checks that every
  grid falls back to one column on a phone.
- **Settings.** Theme (dark by default, light, or follow the system), English
  or Vietnamese, and hidden scrollbars. Hidden scrollbars still scroll from
  the keyboard.
- **Plain text.** Every game has its own page. The Games page exports what you
  have filtered as CSV or JSON. The whole dataset is plain JSONL in
  [`data/`](data/), and the two leaderboards are Markdown tables in
  [`games/`](games/).

## Known limitations

Known, and not fixed yet. Where there is another way to get the same thing, it
says so.

- **The games table is not a table to a screen reader.** Its rows are links
  dressed up as table rows with no table around them, and three of its columns
  have no header text. Each row takes two <kbd>Tab</kbd> presses, because the
  Steam icon inside it is a second stop. Only the rows on screen exist in the
  page, so a screen reader's browse mode and the browser's find-in-page see
  only those.
  *Instead:* narrow the list with search and the filters, open a game's own
  page, or export to CSV/JSON. The [Markdown leaderboards](games/) are
  ordinary tables.
- **The first-run screens.** Before the site opens you get the terms screen,
  then (website only) a human check. Neither moves keyboard focus into itself
  or keeps it there, so <kbd>Tab</kbd> walks through the hidden page behind
  first. The terms screen is also not announced as a dialog, and each screen
  adds a second main heading while it is open. The human check is Cloudflare
  Turnstile, in a frame this project does not control. If it says your
  browser is unsupported, there is no retry button.
  *Instead:* the desktop and Android apps never show the human check, and
  everything in the catalogue is readable on GitHub.
- **Charts.** Values, tooltips and legends are drawn on a canvas and need a
  pointer. Several charts have no text version: DRM, languages, platforms,
  players, reviews, release years, delisted games, most of *Stats*, and the
  genre chart on the dashboard. Several tell categories apart by colour alone.
  Chart animations ignore *reduce motion*.
  *Instead:* the CSV/JSON export, or the raw data.
- **Colour.**
  - Kernel-level anti-cheat is shown only by a red badge instead of an amber
    one: in the games table, the cards, a game's page and *Random games*.
    *Instead:* the [anti-cheat list](https://free-steam-games.win/charts/anti-cheat/list)
    says it in words.
  - In the light theme, links, primary buttons, warnings and some badges are
    below the 4.5:1 contrast WCAG asks of text.
    *Instead:* the dark theme, which is the default.
  - The borders of text boxes and drop-downs are below 3:1 in both themes.
  - Contrast themes (forced colours) get no special support.
- **Hover-only hints.** The 💀 on a dead game and the warning icon in a table
  row explain themselves only in a mouse-hover tooltip. A screen reader just
  reads "skull".
  *Instead:* **Hide dead** on the Games page takes dead games out of the
  list.
- **Changes that are not announced:** the number of results after you filter,
  the page number, and loading or error messages. The pop-up notifications'
  own labels ("Notifications", "Close toast") stay in English when the app is
  in Vietnamese.
- **Text in another language is not marked as such.** The legal documents
  exist only in English. Game names and descriptions are in whatever language
  the developer wrote them. None of it is tagged, so a screen reader reads it
  in the interface language's voice.
- **Zoom.**
  - On the website, the games list and the cards sit in boxes sized to the
    window, so at 300-400% zoom they shrink to almost nothing. Long values
    are cut off with "…", and a few small labels have fixed pixel sizes.
  - The desktop app has page zoom turned off: <kbd>Ctrl</kbd>+<kbd>+</kbd>
    does nothing. As far as the code shows, the Android app does not
    pinch-zoom either.
  - *Instead:* game pages and the CSV/JSON export; the website in a browser;
    or your system's magnifier or text size.
- **The command palette's search box** shows no focus ring.
- **No automated accessibility tests.** Svelte's accessibility warnings show
  up in development but do not fail the build.

## Supported environments

| Where | Runs on | Checked by hand |
| --- | --- | --- |
| Website | Any current browser | Chrome, Edge, Firefox and Brave on Windows 11; Safari, Chrome and Brave on iOS 26 (iPhone 14 Pro, iPhone 13 Pro Max) |
| Desktop app | WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux) | Windows 11. The macOS and Linux builds are not checked by hand. |
| Android app | Android System WebView, Android 11 or newer | Emulator (Android 11 to 16) and a vivo 1907 (Android 12) |

The apps get their accessibility from the system's web view. What a screen
reader can do in them is roughly what it can do in Edge on Windows, Safari on
macOS, or Chrome on Android. The full device list is in
[`docs/pc_spec.md`](docs/pc_spec.md).

**Assistive technology used so far:** the keyboard alone, and the Narrator and
NVDA screen readers on Windows.
**Not tried yet:** JAWS, VoiceOver (macOS, iOS), TalkBack (Android), Orca
(Linux). Reports from any of them are especially welcome.

## Reporting a barrier

Open an issue with the
**[♿ Accessibility barrier](https://github.com/poli0981/free-steam-games-list/issues/new?template=accessibility.yml)**
form. You don't have to say anything about yourself or any disability: what
you were trying to do, and what got in the way, is enough. Screenshots and
recordings are welcome, but never required.

Rather not post in public, or no GitHub account? Email
**contact@poli0981.dev**.

What helps, if you have it:

- the page: its address, or its name in the app;
- what you tried to do, and what happened instead;
- the browser or app, and its version. The app version is shown as
  "Steam · v…" under "F2P Tracker" in the sidebar, or in the menu on a small
  screen;
- your operating system, and any assistive technology or setting involved
  (screen reader, zoom level, high contrast, reduced motion);
- how much it gets in the way: you can't do it at all, it's hard or slow, or
  it's just annoying.

A security problem is not an accessibility report: see
[`SECURITY.md`](SECURITY.md).

## What to expect

One person, as a hobby, in a timezone that is probably not yours. It's the same
deal as [`SECURITY.md`](SECURITY.md).

- A first reply usually within a week.
- Something that stops you using a part of the site or the apps comes first.
  Then things that make it hard or slow, then the cosmetic ones.
- No fixed deadline for a fix. If there is a way around the problem, the reply
  says so.
- Reports get the `accessibility` label. The issue stays open until the fix is
  live: on the website as soon as it is merged, in the desktop and Android
  apps with their next release.
- Credit in the [CHANGELOG](CHANGELOG.md) if you want it.

## For contributors

The same rules for people and for coding agents. For any change to the
interface:

- Use it with the keyboard alone. Everything should be reachable with
  <kbd>Tab</kbd>, in a sensible order, with focus always visible and nothing
  that traps it.
- Give every control a name a screen reader can read: a visible label, or an
  `aria-label` on an icon button. Images get `alt`, empty (`alt=""`) when they
  only decorate.
- Never say something with colour alone, or only in a hover tooltip.
- Check it 360 px wide, at 200% zoom, in both themes, and with *reduce motion*
  on.
- Build overlays and pop-ups on Bits UI's `Dialog` (focus trap,
  <kbd>Esc</kbd>, focus returned), not a hand-made `div`.
- Put new text in both `web/src/i18n/locales/en.json` and `vi.json`.
- Read the accessibility warnings `npm run check` prints. CI does not fail on
  them, so nobody else will. Add no new `svelte-ignore a11y_*` without giving
  a reason in the pull request.

The [pull request template](.github/pull_request_template.md) has the short
version as a checklist. Coding agents also follow [`CLAUDE.md`](CLAUDE.md),
which says to keep this file true.

## Keeping this honest

- **Owner:** the maintainer, [@poli0981](https://github.com/poli0981).
- A change that fixes a limitation above, or adds one, updates this file in the
  same pull request.
- This file is read through again whenever an app release changes the
  interface.
- Ideas for the statement itself go to
  [Discussions › Ideas](https://github.com/poli0981/free-steam-games-list/discussions/categories/ideas),
  or an issue.

*Last reviewed: 2026-11-09 (website and apps 2.5.0).*
