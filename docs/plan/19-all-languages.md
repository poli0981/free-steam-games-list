# Every language — games whose store page has no English

## Why this note exists

On 2026-10-30 the maintainer asked why a free Japanese game,
[`//トロイメライ・ノクターン`](https://store.steampowered.com/app/5118700/)
(5118700), was nowhere in the catalogue, and for an assessment of every
workflow a game like it passes through, a plan, and the change. This is that
assessment and the decisions it led to. Every number below was measured on
the day with read-only requests to Steam and the repository's own data
(`main` at 60b710a6, 12,854 games).

The short version: one parameter kept them out. Discovery searched Steam with
`supportedlang=english`, a choice made when discovery was designed
([11-design-discovery.md](11-design-discovery.md) §6, "a one-line knob if you
later decide the tracker should be language-neutral"). Everything after
discovery already handled these games: 275 of them were in the catalogue,
added before discovery existed, and were displayed, reviewed, refreshed and
purged like any other.

## The example game

| Question | Answer |
| --- | --- |
| Free, a game? | `is_free: true`, `type: game` (appdetails, US, JP and VN) |
| Sold in the US? | Yes: GetItems (US) `visible`, free, 4 reviews, 100 % |
| Languages | `Japanese` only |
| Store text | An English description exists; the name is Japanese only |
| In the repository? | No: not in `data/`, the queue, `removed_games.jsonl` or the blocklist |

## What Steam lists

Steam's search (`category1=998`, `maxprice=free`), walked to the end both ways:

| Search | Free games |
| --- | --- |
| `supportedlang=english` | 17,198 |
| No language filter | 18,790 |
| No filter, with `l=english` or `Accept-Language: ja` | 18,790 |

Every game of the first list is in the second, so the difference is exactly
**1,592 games that do not list English**. Without the parameter Steam applies
no language filter of its own. These counts were taken from Vietnam; search
results depend on the country (GitHub's US runners saw 17,259 English-listing
games the same morning).

Supported languages of those 1,592, from `supportedlang=english,<X>` minus the
English count (a game can count under several):

| Language | Games |
| --- | --- |
| Simplified Chinese | 784 |
| Japanese | 317 |
| Korean | 165 |
| Traditional Chinese | 164 |
| French / Spanish / Russian / German / Portuguese (Brazil) | 51 / 45 / 40 / 32 / 31 |
| Any other single language | 23 or fewer |
| No language declared at all | 29 |

Of the 1,592, **275 were already in the catalogue**; the other **1,317** were
not. By release year:

| ≤2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 62 | 63 | 70 | 83 | 139 | 175 | 229 | 270 | 226 |

The English backlog had been swept back to 2019 (the last Backfill Discovery
run that morning was 2019 Q4), so every window from 2019 to 2026 needed one
more pass; older windows get these games as they are swept for the first time.

## What each workflow does with such a game

| Workflow | Before this change | Change |
| --- | --- | --- |
| Discover New Games (daily, ≤5 newest pages) | Never sees it | Search every language |
| Backfill Discovery (by year or quarter) | Never sees it | Same search; re-sweep 2019-2026 |
| `/admin` queue, auto-approve | No language rule, but nothing tells a reviewer which languages a game supports | Candidates carry their languages; "No English" badge |
| Ingest (`ingest_new.py`, `fetch_full`) | Any link form (percent-encoded slug, raw Japanese slug, `?l=`) becomes `/app/<id>/`. Name, description and developer keep their script; tags, genre, language names, review labels and dates are English, because every request asks Steam in English | None, apart from the two points below |
| Update Reviews, anti-cheat, Peaks, Purge | Nothing depends on the language. Reviews are GetItems' `summary_filtered`, which counts every language, so a Japanese game with Japanese reviews has its full score | None |
| Refresh Store Data | As above. A game that declares no language keeps empty `languages`, so the daily repair group takes it every day and the admin Quality page flags it | None; accepted for the 29 such games |
| Web app | Names and descriptions display (CJK through the system's fonts); search finds exact substrings | Language filter, CJK-aware search, CSV for Excel |
| Region | Every request goes out as the US (runners, `country_code: US`): a game not sold there is refused as `unavailable` | Out of scope |

Two smaller problems turned up in the pipeline:

- **Digits that are not ASCII.** Python's `\d` also matches full-width
  (`５１１８７００`, what a Japanese keyboard types) and other scripts' digits.
  A queued link in such digits, which only a pull request could add, gave an
  appid that missed every comparison and made `rotation.slice_of()` raise on
  `.encode("ascii")`, stopping Refresh Store Data, Peaks and Refetch for every
  game. The Worker and `web/shared/removal.ts` already took ASCII only;
  `scripts/core/blocklist.py` did not, and its `$` also let `"730\n"` through.
- **Cutting a CJK blurb.** `truncate_description()` backed off only to an
  ASCII space and trimmed only Latin punctuation before the ellipsis, so a
  Chinese or Japanese blurb was cut mid-phrase, and two stored ones end in
  `。…`.

And in the web app:

- `/games` had no language filter, and `languages` is not a search key, so a
  reader of English had no way to leave out the games they cannot play.
- Every search box only lowercased, so `ﾄﾛｲ` (half-width), `とろい` (hiragana)
  and `トロイ` were three different searches, as were `４` and `4`.
- The header search jumped to `/games` on the first keystroke an input method
  had not finished composing.
- The command palette waited for two characters; one kanji found nothing.
- The CSV download had no byte order mark, so Excel, Japanese Windows
  included, opened every CJK name as mojibake.

## What changed (v4.6.0)

- **Discovery searches every language.** `fetch_search_page()` sends no
  `supportedlang`, and sends `l=english`, which fixes the language of the row
  text (discovery skips "Coming soon" rows, the backfill reads English month
  names) without changing which rows come back.
- **Candidates carry their languages.** `appdetails_languages()` reads
  appdetails' `supported_languages` HTML into a list in the payload; dry runs
  print "no English: …" and each run counts the candidates without English.
  `/admin`'s candidate dialog shows the list and a "No English" badge.
  Auto-approve is unchanged: the maintainer chose to treat these games like
  any other.
- **The `discovery` group queues** (`queue: max` in both workflows), and the
  backfill takes a `max_pages` input. `pipeline.test.ts` now holds every
  shared group to one queue setting.
- **ASCII appids.** `extract_appid` refuses a run of digits with a non-ASCII
  one in it; `normalize_link()` reads NFKC first, so `５１１８７００` is
  5118700; the blocklist uses ASCII digits and `fullmatch`.
- **CJK blurbs** are cut just after the last `。！？` when that is later than
  the last space and in the last 40 %, and `、。，．：；` are trimmed before
  the ellipsis. Stored descriptions (all within the cap) never change;
  `_fuller_cut()` lets Refresh Store Data write a re-cut without counting it
  as news.
- **Web:** a language filter on `/games` (`?lang=`, counted like the others),
  `fold()` (NFKC plus hiragana to katakana) on both sides of every search box,
  the header search waiting for the input method, one CJK character enough in
  the palette, and a byte order mark on CSV downloads. The About page says
  the catalogue covers every language.

The legal documents were not edited. DISCLAIMER §2 and ToS item 2 say the
pipeline asks Steam in English and parses English answers, which is still
true; an edit would change their hash and reopen the consent gate for
everyone. No filter is stored under an `f2p:` key, so the privacy policy is
unchanged too.

## The re-sweep

After the merge, Backfill Discovery was dispatched once per year from 2019 to
2026, `limit=1000`, `max_pages=60` (a whole recent year is about 30 pages).
A window counts as done only when its log says "walked past the window"; a
run that reaches its limit is run again. Windows before 2019 get their
non-English games when they are first swept.

## Left for later

- **Genre "Free To Play".** `SKIP_GENRE_TAGS` holds `"Free to Play"`, but
  appdetails writes `"Free To Play"` and the comparison is case-sensitive:
  1,084 records have that genre, 809 of them added since 2026-10-01. `genre`
  is a human-judgement field, so the fix needs its own decision.
- **Games not sold in the US.** Every request goes out as the US; covering
  region-locked games needs another country or runner.
- **CJK fonts and `lang`.** CJK text renders in the system's font (a Linux
  machine without one shows boxes), and no element marks a game's name with
  its language, so shared Han characters may take Chinese shapes in Japanese
  names. A self-hosted CJK font is megabytes; guessing a name's language from
  its script would be wrong for many Han-only names.
