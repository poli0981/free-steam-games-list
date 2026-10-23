# Pipeline scale — the data workflows as the catalogue grows

## Why this note exists

On 2026-10-23 the maintainer asked for an assessment of the GitHub Actions
data workflows now that the catalogue grows by hundreds of games a day, a
direction for them, and the change. This is that assessment and the decisions
it led to. Every number below was measured on the day (`main` at 01a631bb,
9,847 games), with `gh run list` over each workflow's last 40 runs and live,
read-only requests to Steam.

The short version: three jobs asked Steam about every game one request at a
time, two seconds a game, and had reached GitHub's six-hour limit; the
`data-write` group cancelled half of the runs that waited for one of them;
and the runs that did wait worked on stale data. Steam answers fifty games a
request in its store API, and GitHub can now queue runs. The pipeline uses
both, and every long loop now stops in time to save.

## What the catalogue does to each job

The catalogue held 9,847 games and grew by about 280 a day (auto-approve is
capped at 500); Steam lists about 17,000 free games matching its filters, so
the plan is sized for 20,000.

A per-game loop cost about 2.05 s a game against store endpoints (a
1.2-2.0 s throttle, plus `process_batch`'s 15-30 s rest after every 50 games)
and about 1.0 s against the keyed Web API, of which the rests were half.

| Workflow | Before | Measured | At 20,000 games |
| --- | --- | --- | --- |
| Update Reviews (every 2 days) | `appreviews`, one game a request | 2026-10-23: stopped at exactly 6:00:00, nothing saved; 5 of the last 10 runs cancelled while waiting | impossible |
| Check Dead Links (every 5 days) | HEAD on every store page, flags 404/410 | 5.5 h on 2026-10-21; `dead_links.log` never existed and every game is `active`: Steam sends a delisted app's page to the store front, 200 | impossible |
| Purge Unhealthy (Mondays) | appdetails for every game, one answer enough to remove | 5.3 h on 2026-10-19 | impossible |
| Auto Update JSON (daily) | incomplete records only | 1 minute, but failed 4 days in 10 (below) | fine |
| Top Online (3 a week) | player count for each online game | 48 min (2,898 games) | ~1.7 h |
| Top Offline (twice a month) | player count for each offline game | 88 min (6,949 games) | ~4 h |
| Refresh Store Data (daily) | a 7-day / 30-day rotation | 65 min of a 120-minute timeout | ~2.2 h: over |
| Refresh All-Time Peaks (daily) | a 30-day rotation on SteamCharts | 14 min of a 30-minute timeout | ~29 min: at the edge |
| Force Re-fetch (manual) | everything in one run | ~6.5 s a game, 18 hours | impossible |

Three problems were not about speed:

- **A stopped job is silent.** A job killed at its timeout commits nothing and
  concludes `cancelled`. `notify-ci-failure.yml` hands runs to a reusable
  workflow in `poli0981/.github` that reports only `failure`, so nobody heard
  that Update Reviews had stopped working.
- **The `data-write` group kept ONE pending run.** A run that queued behind a
  running job cancelled the one already waiting. The ingest's three-hourly
  schedule made that happen every morning: Update Reviews was cancelled on
  10-05, 10-11, 10-15, 10-19 and 10-21.
- **Queued runs worked on stale data.** A run's commit is fixed when the run
  is created. Auto Update JSON is created at 00:00 together with the ingest's
  schedule; when the ingest ran first and committed, Auto Update JSON wrote
  shards from before that commit, and `commit_push.sh`'s rebase failed on
  `data/index.json` (10-15, 10-16, 10-17, 10-18). Only three workflows checked
  out `ref: main`.

## What Steam's store API answers

`IStoreBrowseService/GetItems` (keyless, already used for gated games and the
anti-cheat sweep) answered for the whole catalogue in 99 requests and 105
seconds (100 ids a request; 200 also worked, 500 is refused at the edge for
the URL's length). Each item carries what the slow jobs asked for:

- `reviews.summary_filtered`: `review_count`, `percent_positive`,
  `review_score_label` - the summary the store shows, in the vocabulary
  `appreviews` uses ("3 user reviews", "Mixed").
- `visible`, `unlisted` (true for delisted apps), `is_free` (absent when not
  free), `release.is_coming_soon`, `type`.

Compared with the stored reviews (read from `appreviews` on 10-17, rounded):
5,296 identical, 3,795 exactly one point lower - Steam floors its percentage
(85 for Counter-Strike 2, which `round()` had made 86) - 287 with a new label,
and 4 where GetItems said 0 reviews for a game the store page shows with
thousands (845070) or a few. Its 0 is not to be trusted alone.

Screening every game the way purge would: 3 `unlisted` (appdetails calls them
not free: removed), 5 without `is_free` (appdetails calls two of them free:
kept), nothing hidden, unknown or coming soon. The dry run of the new purge on
the real catalogue matched: 8 flagged, 3 removed, 5 kept by appdetails.

Of the 142 games removed before, GetItems now sees 27 as free and listed
again. Most were never really gone: 14 were rejected by the ingest in two
bursts on 2026-09-27, when appdetails answered `success:false` for live games,
and were approved again later. Eight are still out; the new purge names them.

GitHub Actions has supported `concurrency.queue: max` since 2026-05-07: up to
100 waiting runs, first in, first out, with `cancel-in-progress: false`.

## The direction

1. **Queue, don't evict.** Every data-write workflow has `queue: max` and
   checks out `ref: main`, so a run that waits loses nothing and works on what
   the run before it committed.
2. **Batch, don't crawl.** Reviews and the purge screen come from GetItems:
   about 200 requests for the catalogue, whatever its size within reason.
   Requests per game are kept for confirming a removal and for the rare
   review count of 0.
3. **Bound every run.** A job sets `JOB_BUDGET_MINUTES` below its timeout;
   a loop past it starts no further game and the script saves what it did.
   Loops visit games in an order that changes daily, rotations grow their
   cycle (a multiple of the base) instead of their daily slice, and a
   `::warning::` says when a loop used more than three quarters of its budget.
4. **Drop what does nothing.** Check Dead Links goes, and so do the rests
   between batches of the keyed Web API.

Considered and left: a matrix of runners per job (still a request per game,
parts racing each other's pushes, and SonarCloud's S8233 on workflow-level
write permissions with more than one job), a self-hosted runner, the Worker's
cron (the Worker may never write a shard), and a second opinion from GetItems
for the ingest's rejections (a skipped link and a rejected one both end as a
`failed` queue row; only the public log line differs).

## What changed

| Job | Now | Time at 9,847 | At 20,000 |
| --- | --- | --- | --- |
| Update Reviews | daily; GetItems, `appreviews` only for a 0 (at most 300) | ~2-5 min | ~5 min |
| Purge Unhealthy | daily; GetItems screen, appdetails confirms each flag | ~3-8 min | ~5-10 min |
| Check Dead Links | retired | 0 | 0 |
| Top Online / Offline | no rests between batches | ~27 / ~64 min | ~55 min / ~2.1 h |
| Refresh Store Data | cycles 7 → 14 past 2,000 pages a day, 30 → 60 past 500 appdetails | ~65 min | ~65-90 min |
| Refresh All-Time Peaks | cycle 30 → 60 past 400 pages a day | ~14 min | ~15 min |
| Force Re-fetch | parts `1/8` … `8/8`, queued | ~2.2 h a part | ~2.2 h a part (`1/16`…) |

Rules worth keeping (CLAUDE.md has them in full):

- **Reviews.** Steam's floored percentage, in integers (`29/100*100` is 28.99…
  in floating point). A GetItems count of 0 never writes; a stored percentage
  or "N/A" is asked on `appreviews` instead. No answer keeps the value.
  `last_updated` moves on a change, and on a heartbeat every 14-20 days for a
  game that was read: the site's "stale" badge (30 days) used to be kept quiet
  by this job stamping every game every run, which also rewrote every shard.
- **Purge.** Remove only when GetItems flags a game AND `check_game_health()`
  agrees; ask an `unavailable` again five minutes later; never treat a failed
  batch or a network error as "gone"; stop before writing anything past 500
  flags or 100 removals; log as before; name earlier removals Steam has since
  undone. A purged game keeps its D1 decision, so discovery never proposes it
  again - the notice is the way back.
- **Budgets.** Never for the ingest: `clear_temp()` empties its whole queue.
  Refetch clears a game on a copy and swaps it in only once appdetails has
  answered, oldest first, so a part cut short resumes where it stopped.

`web/shared/pipeline.test.ts` now fails on a data-write workflow without
`queue: max`, `cancel-in-progress: false`, `ref: main` on every checkout, a
`timeout-minutes`, or a budget less than 20 minutes below it.

## Load, before and after

| | Before | After |
| --- | --- | --- |
| Time the data-write group is busy | ~46 h a week | ~12 h a week |
| Requests to Steam | ~82,000 a week | ~25,000 a week |
| Runs cancelled while waiting | about one a day | none |

## Left for later

- **A timed-out run is still silent.** The reusable notifier in
  `poli0981/.github` reports `failure` only; reporting `cancelled` for the
  data workflows (now that waiting no longer cancels anything) belongs there.
- **Workers Builds deploys on data commits** (`docs/DEPLOYMENT.md`, "Which
  commits deploy"). Daily reviews and purges add about one deploy a day until
  the watch paths are set.
- **`data/snapshots/`** grows by 1.9 MB a day and nothing in the repository
  reads it. A leaner format (no name, no zero rows) would quarter it.
- **The keyed player counts** are the last per-game loop. At 20,000 games
  Top Offline needs about two hours; past that, sample games with no players
  on a rotation instead of every run.
- **Re-queue what Steam has undone**: the purge's notice lists the removed
  games that are free and on the store again.
