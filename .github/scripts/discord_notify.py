"""
Discord webhook notification helper.

Stdlib-only (matches the notify.py pattern from youtube-auto-post).
Drop this into .github/scripts/ in any repo and call from a workflow.

Usage:
    python discord_notify.py release    # release announcement
    python discord_notify.py failure    # CI failure alert

All config comes from environment variables (workflow inputs + GitHub context).
"""

from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# ---------- Config ----------

# Embed color hex (decimal) — keep distinct per event type for quick visual scan
COLOR_RELEASE = 0x57F287  # green
COLOR_FAILURE = 0xED4245  # red
COLOR_PRERELEASE = 0xFEE75C  # yellow

# Release-notes truncation: Discord embed description hard-caps at 4096 chars,
# but ~1500 keeps the embed scannable without scrolling.
MAX_NOTES_CHARS = 1500
MAX_ASSETS_LISTED = 5

# Discord field value cap is 1024; truncate workflow logs/error excerpts to fit.
MAX_FIELD_VALUE = 1000


# ---------- Helpers ----------

def _post_webhook(url: str, payload: dict) -> bool:
    """POST a JSON payload to a Discord webhook. Returns True on 2xx."""
    if not url:
        print("[SKIP] No webhook URL provided.")
        return False

    # Normalize: support discordapp.com and bare /webhooks/ URLs
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
            "User-Agent": "poli0981-cicd/1.0 (+https://github.com/poli0981)",
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


def _truncate(text: str, limit: int, suffix: str = "…") -> str:
    """Truncate text to limit, appending suffix if cut. Word-boundary aware."""
    if not text or len(text) <= limit:
        return text or ""
    cut = text[: limit - len(suffix)]
    last_break = max(cut.rfind("\n"), cut.rfind(". "))
    if last_break > limit * 0.6:
        cut = cut[:last_break]
    return cut.rstrip() + suffix


def _env(name: str, default: str = "") -> str:
    """Get env var, stripping whitespace."""
    return os.environ.get(name, default).strip()


def _required(name: str) -> str:
    """Get env var or exit with error."""
    v = _env(name)
    if not v:
        print(f"[ERROR] Required env var not set: {name}")
        sys.exit(1)
    return v


# ---------- Release announcement ----------

def build_release_embed() -> dict:
    """Build a rich embed for a published release."""
    repo = _required("GITHUB_REPOSITORY")  # e.g. "poli0981/autoclick"
    repo_name = repo.split("/", 1)[1]
    server_url = _env("GITHUB_SERVER_URL", "https://github.com")

    tag = _required("RELEASE_TAG")
    name = _env("RELEASE_NAME") or tag
    body = _env("RELEASE_BODY")
    html_url = _env("RELEASE_URL") or f"{server_url}/{repo}/releases/tag/{tag}"
    is_prerelease = _env("RELEASE_PRERELEASE", "false").lower() == "true"

    # Asset URLs come in as a JSON array string from the workflow
    assets_raw = _env("RELEASE_ASSETS_JSON", "[]")
    try:
        assets = json.loads(assets_raw) if assets_raw else []
    except json.JSONDecodeError:
        assets = []

    color = COLOR_PRERELEASE if is_prerelease else COLOR_RELEASE
    badge = " (pre-release)" if is_prerelease else ""

    # Description: truncated release notes
    description = _truncate(body, MAX_NOTES_CHARS) if body else "*No release notes provided.*"

    fields = []

    # Asset list — most-relevant first (installers > portable > source)
    if assets:
        asset_lines = []
        priority_order = (".msi", ".exe", ".dmg", ".AppImage", ".deb", ".rpm", ".zip")

        def asset_priority(a: dict) -> int:
            n = a.get("name", "").lower()
            for i, ext in enumerate(priority_order):
                if n.endswith(ext.lower()):
                    return i
            return len(priority_order)

        sorted_assets = sorted(assets, key=asset_priority)[:MAX_ASSETS_LISTED]
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
        "footer": {
            "text": f"{repo} • {name}" if name != tag else repo,
        },
        "timestamp": _env("RELEASE_PUBLISHED_AT") or None,
    }

    # Strip None/empty values Discord rejects
    embed = {k: v for k, v in embed.items() if v}

    return embed


def post_release() -> int:
    """Post a release announcement to one or more Discord webhooks."""
    embed = build_release_embed()
    repo = _required("GITHUB_REPOSITORY")
    tag = _required("RELEASE_TAG")

    # Webhooks: comma-separated list of URLs (e.g. #releases + #<repo>-activity)
    webhooks_raw = _required("DISCORD_WEBHOOKS")
    webhooks = [w.strip() for w in webhooks_raw.split(",") if w.strip()]

    payload = {
        "username": "Release Bot",
        "embeds": [embed],
        # content shows up as a regular message above the embed — useful for
        # @-mentions/role pings; leave blank by default to avoid noise
        "content": _env("DISCORD_CONTENT", ""),
    }
    if not payload["content"]:
        payload.pop("content")

    print(f"[INFO] Announcing {repo}@{tag} to {len(webhooks)} webhook(s).")

    failures = 0
    for i, url in enumerate(webhooks, 1):
        print(f"[INFO] Webhook {i}/{len(webhooks)}…")
        if not _post_webhook(url, payload):
            failures += 1

    if failures == len(webhooks):
        print("[ERROR] All webhooks failed.")
        return 1
    if failures:
        print(f"[WARN] {failures}/{len(webhooks)} webhook(s) failed.")
    return 0


# ---------- CI failure alert ----------

def build_failure_embed() -> dict:
    """Build a compact embed for a failed workflow run."""
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

    fields = [
        {"name": "Workflow", "value": f"`{workflow_name}` (run #{run_number}, attempt {run_attempt})", "inline": False},
    ]
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

    embed = {
        "title": f"❌ CI failed: {repo}",
        "url": run_url,
        "description": f"**[View run logs →]({run_url})**",
        "color": COLOR_FAILURE,
        "fields": fields,
        "footer": {"text": f"{repo}"},
    }

    return embed


def post_failure() -> int:
    """Post a CI failure alert to the dev-internal webhook."""
    embed = build_failure_embed()
    webhook = _required("DISCORD_CI_WEBHOOK")

    payload = {
        "username": "CI Bot",
        "embeds": [embed],
    }

    print(f"[INFO] Posting CI failure for {_env('GITHUB_REPOSITORY')}…")
    return 0 if _post_webhook(webhook, payload) else 1


# ---------- Entry point ----------

def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: discord_notify.py <release|failure>")
        return 2

    cmd = sys.argv[1].lower()
    if cmd == "release":
        return post_release()
    if cmd == "failure":
        return post_failure()

    print(f"[ERROR] Unknown command: {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
