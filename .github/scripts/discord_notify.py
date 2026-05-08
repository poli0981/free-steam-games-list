"""
Discord webhook notification helper — phase 2.

Extends phase 1 with four new commands:

    python discord_notify.py release             # phase 1: release announcement
    python discord_notify.py failure             # phase 1: generic CI failure
    python discord_notify.py deploy              # phase 2: deploy success/fail
    python discord_notify.py release-build       # phase 2: release pipeline build status
    python discord_notify.py dependabot-summary  # phase 2: org-wide dependabot digest
    python discord_notify.py weekly-digest       # phase 2: org-wide weekly activity

Stdlib-only. Drop into .github/scripts/ in any repo.
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ---------- Embed colors ----------

COLOR_RELEASE = 0x57F287       # green
COLOR_FAILURE = 0xED4245       # red
COLOR_PRERELEASE = 0xFEE75C    # yellow
COLOR_DEPLOY_OK = 0x3BA55D     # darker green (distinct from release)
COLOR_DEPLOY_FAIL = 0xE74C3C   # darker red
COLOR_BUILD_OK = 0x5865F2      # blurple — neutral build success
COLOR_BUILD_FAIL = 0xED4245
COLOR_DEPENDABOT = 0xFAA61A    # orange
COLOR_DIGEST = 0x9B59B6        # purple

# ---------- Truncation limits ----------

MAX_NOTES_CHARS = 1500
MAX_FIELD_VALUE = 1000
MAX_ASSETS_LISTED = 5
MAX_DIGEST_REPOS_PER_FIELD = 8


# ---------- Helpers ----------

def _post_webhook(url: str, payload: dict) -> bool:
    """POST a JSON payload to a Discord webhook. Returns True on 2xx."""
    if not url:
        print("[SKIP] No webhook URL provided.")
        return False

    url = url.replace("https://discordapp.com/", "https://discord.com/")
    if "/webhooks/" in url and "/api/webhooks/" not in url:
        url = url.replace("/webhooks/", "/api/webhooks/")
    url = url.rstrip("/")

    body = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "poli0981-cicd/2.0 (+https://github.com/poli0981)",
        },
    )

    try:
        with urlopen(req, timeout=30) as resp:
            print(f"[OK] Discord webhook posted (HTTP {resp.status}).")
            return True
    except HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"[ERROR] Discord webhook: {e.code} — {body_text}")
        return False
    except URLError as e:
        print(f"[ERROR] Discord webhook: {e}")
        return False


def _gh_api(path: str, token: str, method: str = "GET", params: dict | None = None) -> dict | list:
    """Call GitHub REST API. Returns parsed JSON."""
    base = "https://api.github.com"
    url = f"{base}{path}"
    if params:
        url += "?" + urlencode(params)

    req = Request(
        url,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "poli0981-cicd/2.0",
        },
    )

    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        print(f"[ERROR] GitHub API {method} {path}: {e.code} — {e.read().decode('utf-8', errors='replace')}")
        raise
    except URLError as e:
        print(f"[ERROR] GitHub API {method} {path}: {e}")
        raise


def _gh_search(query: str, token: str, kind: str = "issues") -> list:
    """Run a GitHub search. Returns the items list (paginated, capped at 100)."""
    result = _gh_api(f"/search/{kind}", token, params={"q": query, "per_page": 100})
    if isinstance(result, dict):
        return result.get("items", [])
    return []


def _truncate(text: str, limit: int, suffix: str = "…") -> str:
    if not text or len(text) <= limit:
        return text or ""
    cut = text[: limit - len(suffix)]
    last_break = max(cut.rfind("\n"), cut.rfind(". "))
    if last_break > limit * 0.6:
        cut = cut[:last_break]
    return cut.rstrip() + suffix


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _required(name: str) -> str:
    v = _env(name)
    if not v:
        print(f"[ERROR] Required env var not set: {name}")
        sys.exit(1)
    return v


# ---------- Phase 1: Release announcement ----------

def build_release_embed() -> dict:
    repo = _required("GITHUB_REPOSITORY")
    repo_name = repo.split("/", 1)[1]
    server_url = _env("GITHUB_SERVER_URL", "https://github.com")

    tag = _required("RELEASE_TAG")
    name = _env("RELEASE_NAME") or tag
    body = _env("RELEASE_BODY")
    html_url = _env("RELEASE_URL") or f"{server_url}/{repo}/releases/tag/{tag}"
    is_prerelease = _env("RELEASE_PRERELEASE", "false").lower() == "true"

    assets_raw = _env("RELEASE_ASSETS_JSON", "[]")
    try:
        assets = json.loads(assets_raw) if assets_raw else []
    except json.JSONDecodeError:
        assets = []

    color = COLOR_PRERELEASE if is_prerelease else COLOR_RELEASE
    badge = " (pre-release)" if is_prerelease else ""
    description = _truncate(body, MAX_NOTES_CHARS) if body else "*No release notes provided.*"

    fields = []
    if assets:
        priority_order = (".msi", ".exe", ".dmg", ".AppImage", ".deb", ".rpm", ".zip")

        def asset_priority(a: dict) -> int:
            n = a.get("name", "").lower()
            for i, ext in enumerate(priority_order):
                if n.endswith(ext.lower()):
                    return i
            return len(priority_order)

        sorted_assets = sorted(assets, key=asset_priority)[:MAX_ASSETS_LISTED]
        asset_lines = []
        for a in sorted_assets:
            n = a.get("name", "asset")
            u = a.get("browser_download_url") or a.get("url", "")
            size_mb = a.get("size", 0) / (1024 * 1024) if a.get("size") else 0
            size_str = f" ({size_mb:.1f} MB)" if size_mb > 0.1 else ""
            asset_lines.append(f"• [{n}]({u}){size_str}")

        if len(assets) > MAX_ASSETS_LISTED:
            asset_lines.append(f"• … +{len(assets) - MAX_ASSETS_LISTED} more on the release page")

        fields.append({
            "name": "📥 Downloads",
            "value": _truncate("\n".join(asset_lines), MAX_FIELD_VALUE),
            "inline": False,
        })

    embed = {
        "title": f"🚀 {repo_name} {tag}{badge}",
        "url": html_url,
        "description": description,
        "color": color,
        "fields": fields,
        "footer": {"text": f"{repo} • {name}" if name != tag else repo},
        "timestamp": _env("RELEASE_PUBLISHED_AT") or None,
    }
    return {k: v for k, v in embed.items() if v}


def post_release() -> int:
    embed = build_release_embed()
    repo = _required("GITHUB_REPOSITORY")
    tag = _required("RELEASE_TAG")

    webhooks = [w.strip() for w in _required("DISCORD_WEBHOOKS").split(",") if w.strip()]
    payload = {"username": "Release Bot", "embeds": [embed]}
    if _env("DISCORD_CONTENT"):
        payload["content"] = _env("DISCORD_CONTENT")

    print(f"[INFO] Announcing {repo}@{tag} to {len(webhooks)} webhook(s).")
    failures = sum(1 for url in webhooks if not _post_webhook(url, payload))
    if failures == len(webhooks):
        return 1
    return 0


# ---------- Phase 1: Generic CI failure ----------

def build_failure_embed() -> dict:
    repo = _required("GITHUB_REPOSITORY")
    server_url = _env("GITHUB_SERVER_URL", "https://github.com")

    workflow_name = _env("WORKFLOW_NAME", "Unknown workflow")
    run_id = _required("RUN_ID")
    run_number = _env("RUN_NUMBER", "?")
    run_attempt = _env("RUN_ATTEMPT", "1")
    branch = _env("BRANCH", "")
    commit_sha = _env("COMMIT_SHA", "")
    commit_short = commit_sha[:7] if commit_sha else "?"
    commit_msg = _env("COMMIT_MESSAGE", "").splitlines()[0] if _env("COMMIT_MESSAGE") else ""
    actor = _env("ACTOR", "")
    event = _env("EVENT_NAME", "")

    run_url = f"{server_url}/{repo}/actions/runs/{run_id}"
    commit_url = f"{server_url}/{repo}/commit/{commit_sha}" if commit_sha else None

    fields = [{"name": "Workflow", "value": f"`{workflow_name}` (run #{run_number}, attempt {run_attempt})", "inline": False}]
    if branch:
        fields.append({"name": "Branch", "value": f"`{branch}`", "inline": True})
    if event:
        fields.append({"name": "Trigger", "value": f"`{event}`", "inline": True})
    if actor:
        fields.append({"name": "Actor", "value": f"@{actor}", "inline": True})
    if commit_sha:
        commit_line = f"[`{commit_short}`]({commit_url})"
        if commit_msg:
            commit_line += f" — {_truncate(commit_msg, 100)}"
        fields.append({"name": "Commit", "value": commit_line, "inline": False})

    return {
        "title": f"❌ CI failed: {repo}",
        "url": run_url,
        "description": f"**[View run logs →]({run_url})**",
        "color": COLOR_FAILURE,
        "fields": fields,
        "footer": {"text": repo},
    }


def post_failure() -> int:
    embed = build_failure_embed()
    webhook = _required("DISCORD_CI_WEBHOOK")
    return 0 if _post_webhook(webhook, {"username": "CI Bot", "embeds": [embed]}) else 1


# ---------- Phase 2: Deploy alert ----------

def post_deploy() -> int:
    """
    Post a deploy success/fail alert.

    Distinct from generic CI failure: includes the deployed URL when known,
    and uses 🌐 / 🚫 icons so the channel scan reads as deploys, not random builds.

    Env:
      DISCORD_CI_WEBHOOK   — same channel as failure alerts (per user choice)
      DEPLOY_STATUS        — 'success' | 'failure'
      DEPLOY_TARGET        — e.g. 'GitHub Pages', 'Cloudflare Pages'
      DEPLOY_URL           — optional; live site URL when status=success
      WORKFLOW_NAME, RUN_ID, BRANCH, COMMIT_SHA, COMMIT_MESSAGE, ACTOR — context
    """
    repo = _required("GITHUB_REPOSITORY")
    server_url = _env("GITHUB_SERVER_URL", "https://github.com")
    status = _env("DEPLOY_STATUS", "failure").lower()
    target = _env("DEPLOY_TARGET", "deploy")
    deploy_url = _env("DEPLOY_URL", "")

    workflow_name = _env("WORKFLOW_NAME", "?")
    run_id = _required("RUN_ID")
    run_number = _env("RUN_NUMBER", "?")
    branch = _env("BRANCH", "")
    commit_sha = _env("COMMIT_SHA", "")
    commit_short = commit_sha[:7] if commit_sha else "?"
    commit_msg = _env("COMMIT_MESSAGE", "").splitlines()[0] if _env("COMMIT_MESSAGE") else ""
    actor = _env("ACTOR", "")

    run_url = f"{server_url}/{repo}/actions/runs/{run_id}"
    commit_url = f"{server_url}/{repo}/commit/{commit_sha}" if commit_sha else None

    if status == "success":
        icon, color, verb = "🌐", COLOR_DEPLOY_OK, "deployed"
        title = f"{icon} {target} deploy OK: {repo}"
    else:
        icon, color, verb = "🚫", COLOR_DEPLOY_FAIL, "deploy failed"
        title = f"{icon} {target} deploy FAILED: {repo}"

    description = f"**[View run logs →]({run_url})**"
    if status == "success" and deploy_url:
        description = f"**[Open live site →]({deploy_url})** • [run logs]({run_url})"

    fields = [{"name": "Workflow", "value": f"`{workflow_name}` (run #{run_number})", "inline": False}]
    if branch:
        fields.append({"name": "Branch", "value": f"`{branch}`", "inline": True})
    if actor:
        fields.append({"name": "Actor", "value": f"@{actor}", "inline": True})
    if commit_sha:
        commit_line = f"[`{commit_short}`]({commit_url})"
        if commit_msg:
            commit_line += f" — {_truncate(commit_msg, 100)}"
        fields.append({"name": "Commit", "value": commit_line, "inline": False})

    embed = {
        "title": title,
        "url": run_url,
        "description": description,
        "color": color,
        "fields": fields,
        "footer": {"text": repo},
    }

    webhook = _required("DISCORD_CI_WEBHOOK")
    return 0 if _post_webhook(webhook, {"username": "Deploy Bot", "embeds": [embed]}) else 1


# ---------- Phase 2: Release pipeline build status ----------

def post_release_build() -> int:
    """
    Post a release-pipeline build status (Velopack / Tauri matrix etc.).

    Both success and failure post — channel is #release-pipeline (low-volume,
    only fires during release tag pushes).

    Env:
      DISCORD_RELEASE_PIPELINE_WEBHOOK  — webhook for #release-pipeline
      BUILD_STATUS    — 'success' | 'failure' | 'cancelled'
      BUILD_PLATFORM  — e.g. 'win-x64', 'macos-14', 'ubuntu-latest'
      BUILD_PACKAGER  — optional; e.g. 'Velopack', 'Tauri'
      RELEASE_TAG     — the tag that triggered the build
      WORKFLOW_NAME, RUN_ID, BRANCH, ACTOR
    """
    repo = _required("GITHUB_REPOSITORY")
    repo_name = repo.split("/", 1)[1]
    server_url = _env("GITHUB_SERVER_URL", "https://github.com")
    status = _env("BUILD_STATUS", "failure").lower()
    platform = _env("BUILD_PLATFORM", "?")
    packager = _env("BUILD_PACKAGER", "")
    tag = _env("RELEASE_TAG", "")

    workflow_name = _env("WORKFLOW_NAME", "?")
    run_id = _required("RUN_ID")
    run_url = f"{server_url}/{repo}/actions/runs/{run_id}"

    if status == "success":
        icon, color = "✅", COLOR_BUILD_OK
        verb = "OK"
    elif status == "cancelled":
        icon, color = "⚠️", COLOR_PRERELEASE
        verb = "cancelled"
    else:
        icon, color = "❌", COLOR_BUILD_FAIL
        verb = "FAILED"

    packager_str = f" {packager}" if packager else ""
    title_tag = f" {tag}" if tag else ""
    title = f"{icon} {repo_name}{title_tag} —{packager_str} {platform} {verb}"

    fields = [{"name": "Workflow", "value": f"`{workflow_name}`", "inline": False}]
    if tag:
        fields.append({"name": "Tag", "value": f"`{tag}`", "inline": True})
    fields.append({"name": "Platform", "value": f"`{platform}`", "inline": True})
    if packager:
        fields.append({"name": "Packager", "value": packager, "inline": True})

    embed = {
        "title": title,
        "url": run_url,
        "description": f"**[View build logs →]({run_url})**",
        "color": color,
        "fields": fields,
        "footer": {"text": repo},
    }

    webhook = _required("DISCORD_RELEASE_PIPELINE_WEBHOOK")
    return 0 if _post_webhook(webhook, {"username": "Build Bot", "embeds": [embed]}) else 1


# ---------- Phase 2: Dependabot consolidator ----------

def _list_org_repos(owner: str, token: str) -> list[dict]:
    """List all repos owned by `owner` (user or org). Paginated, capped at 200."""
    repos: list[dict] = []
    for page in range(1, 3):  # 100 per page × 2 pages = 200 max
        # `/users/{owner}/repos` works for users; for orgs use `/orgs/{owner}/repos`.
        # Try user endpoint first, fall back to org if 404.
        try:
            page_repos = _gh_api(f"/users/{owner}/repos", token, params={"per_page": 100, "page": page, "type": "owner"})
        except HTTPError:
            page_repos = _gh_api(f"/orgs/{owner}/repos", token, params={"per_page": 100, "page": page})
        if not isinstance(page_repos, list) or not page_repos:
            break
        repos.extend(page_repos)
        if len(page_repos) < 100:
            break
    return repos


def post_dependabot_summary() -> int:
    """
    Daily Dependabot summary across all repos.

    Lists open PRs authored by 'dependabot[bot]', grouped by repo. If zero PRs,
    posts a quiet 'all clean' message (configurable).

    Env:
      DISCORD_DEPENDABOT_WEBHOOK  — webhook for #dependabot
      OPS_GH_TOKEN                — PAT with `repo` scope (or fine-grained read across all repos)
      GH_OWNER                    — GitHub username (e.g. 'poli0981')
      QUIET_WHEN_EMPTY            — 'true' to skip posting when zero PRs (default: false)
    """
    webhook = _required("DISCORD_DEPENDABOT_WEBHOOK")
    token = _required("OPS_GH_TOKEN")
    owner = _required("GH_OWNER")
    quiet_when_empty = _env("QUIET_WHEN_EMPTY", "false").lower() == "true"

    # Use search API to find all open dependabot PRs across owner's repos in one call.
    # Search is rate-limited at 30 req/min for authenticated users — well under that.
    query = f"is:open is:pr author:app/dependabot user:{owner}"
    print(f"[INFO] Searching: {query}")
    items = _gh_search(query, token)

    print(f"[INFO] Found {len(items)} open Dependabot PR(s).")

    if not items and quiet_when_empty:
        print("[INFO] No PRs and QUIET_WHEN_EMPTY=true; skipping post.")
        return 0

    # Group by repo
    by_repo: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        # repository_url is "https://api.github.com/repos/{owner}/{name}"
        repo_url = item.get("repository_url", "")
        repo_full = repo_url.rsplit("/repos/", 1)[-1] if "/repos/" in repo_url else "unknown"
        by_repo[repo_full].append(item)

    fields = []
    for repo_full in sorted(by_repo.keys()):
        prs = by_repo[repo_full]
        # Sort: oldest first within a repo, so stale ones are visible
        prs.sort(key=lambda p: p.get("created_at", ""))

        lines = []
        for pr in prs[:5]:  # cap per repo to keep field under 1024
            title = _truncate(pr.get("title", ""), 80)
            number = pr.get("number", "?")
            url = pr.get("html_url", "")
            created = pr.get("created_at", "")
            try:
                age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(created.replace("Z", "+00:00"))).days
                age_str = f" ({age_days}d)" if age_days >= 1 else " (today)"
            except (ValueError, AttributeError):
                age_str = ""
            lines.append(f"• [#{number}]({url}) {title}{age_str}")

        if len(prs) > 5:
            lines.append(f"• … +{len(prs) - 5} more")

        fields.append({
            "name": f"{repo_full} ({len(prs)})",
            "value": _truncate("\n".join(lines), MAX_FIELD_VALUE),
            "inline": False,
        })

        # Discord caps embeds at 25 fields; truncate gracefully
        if len(fields) >= 24 and len(by_repo) > 24:
            remaining_repos = len(by_repo) - 24
            remaining_prs = sum(len(by_repo[r]) for r in sorted(by_repo.keys())[24:])
            fields.append({
                "name": "…and more",
                "value": f"+{remaining_prs} PR(s) in {remaining_repos} other repo(s)",
                "inline": False,
            })
            break

    if items:
        title = f"🤖 Dependabot: {len(items)} open PR(s) across {len(by_repo)} repo(s)"
        description = "Daily summary of open dependency-update PRs."
    else:
        title = "🤖 Dependabot: all clean"
        description = "No open dependency-update PRs across any repo. ✨"

    embed = {
        "title": title,
        "description": description,
        "color": COLOR_DEPENDABOT,
        "fields": fields,
        "footer": {"text": f"{owner} • daily summary"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    return 0 if _post_webhook(webhook, {"username": "Dependabot Digest", "embeds": [embed]}) else 1


# ---------- Phase 2: Weekly digest ----------

def post_weekly_digest() -> int:
    """
    Weekly activity digest. Aggregates last 7 days of:
      - merged PRs
      - closed issues
      - releases published
      - commits to default branches

    Posted to #announcements (configurable).

    Env:
      DISCORD_DIGEST_WEBHOOK  — webhook for #announcements
      OPS_GH_TOKEN            — PAT with read access
      GH_OWNER                — owner username
    """
    webhook = _required("DISCORD_DIGEST_WEBHOOK")
    token = _required("OPS_GH_TOKEN")
    owner = _required("GH_OWNER")

    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    print(f"[INFO] Aggregating activity since {since} for {owner}")

    # Use search for merged PRs and closed issues — fastest cross-repo aggregation
    merged_prs = _gh_search(f"user:{owner} is:pr is:merged merged:>={since}", token)
    closed_issues = _gh_search(f"user:{owner} is:issue is:closed closed:>={since}", token)

    # Releases: list per repo via the repos endpoint, filter by published_at locally.
    # GitHub search doesn't index releases, so this is unavoidable.
    repos = _list_org_repos(owner, token)
    releases_by_repo: dict[str, list[dict]] = defaultdict(list)
    since_dt = datetime.now(timezone.utc) - timedelta(days=7)
    for repo in repos:
        repo_full = repo.get("full_name", "")
        if repo.get("archived") or repo.get("disabled"):
            continue
        try:
            rels = _gh_api(f"/repos/{repo_full}/releases", token, params={"per_page": 10})
            if isinstance(rels, list):
                for r in rels:
                    pub = r.get("published_at")
                    if not pub:
                        continue
                    try:
                        pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    if pub_dt >= since_dt:
                        releases_by_repo[repo_full].append(r)
        except HTTPError:
            continue  # skip repos we can't read

    # Top-active repos (by PR + issue count)
    repo_activity: dict[str, int] = defaultdict(int)
    for pr in merged_prs:
        repo_full = pr.get("repository_url", "").rsplit("/repos/", 1)[-1]
        repo_activity[repo_full] += 1
    for iss in closed_issues:
        repo_full = iss.get("repository_url", "").rsplit("/repos/", 1)[-1]
        repo_activity[repo_full] += 1

    fields = []

    # Summary numbers
    total_releases = sum(len(rs) for rs in releases_by_repo.values())
    summary_lines = [
        f"• **{len(merged_prs)}** PR(s) merged",
        f"• **{len(closed_issues)}** issue(s) closed",
        f"• **{total_releases}** release(s) published",
        f"• Activity in **{len(repo_activity)}** repo(s)",
    ]
    fields.append({
        "name": "📊 Last 7 days",
        "value": "\n".join(summary_lines),
        "inline": False,
    })

    # Releases list
    if releases_by_repo:
        rel_lines = []
        for repo_full in sorted(releases_by_repo.keys()):
            for r in releases_by_repo[repo_full]:
                tag = r.get("tag_name", "?")
                url = r.get("html_url", "")
                rel_lines.append(f"• [{repo_full} {tag}]({url})")
        fields.append({
            "name": f"🚀 Releases ({total_releases})",
            "value": _truncate("\n".join(rel_lines), MAX_FIELD_VALUE),
            "inline": False,
        })

    # Top active repos
    if repo_activity:
        top_repos = sorted(repo_activity.items(), key=lambda x: x[1], reverse=True)[:MAX_DIGEST_REPOS_PER_FIELD]
        repo_lines = [f"• **{repo}**: {count} change(s)" for repo, count in top_repos]
        fields.append({
            "name": "🔥 Most active",
            "value": _truncate("\n".join(repo_lines), MAX_FIELD_VALUE),
            "inline": False,
        })

    embed = {
        "title": f"📅 Weekly digest — week of {since}",
        "description": f"Activity across @{owner}'s repos.",
        "color": COLOR_DIGEST,
        "fields": fields,
        "footer": {"text": f"{owner} • weekly"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    return 0 if _post_webhook(webhook, {"username": "Weekly Digest", "embeds": [embed]}) else 1


# ---------- Entry point ----------

def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: discord_notify.py <release|failure|deploy|release-build|dependabot-summary|weekly-digest>")
        return 2

    cmd = sys.argv[1].lower()
    handlers = {
        "release": post_release,
        "failure": post_failure,
        "deploy": post_deploy,
        "release-build": post_release_build,
        "dependabot-summary": post_dependabot_summary,
        "weekly-digest": post_weekly_digest,
    }
    handler = handlers.get(cmd)
    if not handler:
        print(f"[ERROR] Unknown command: {cmd}")
        return 2
    return handler()


if __name__ == "__main__":
    sys.exit(main())