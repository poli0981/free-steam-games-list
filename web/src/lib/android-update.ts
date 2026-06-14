// Android in-app update check. The Tauri updater plugin is desktop-only, so on
// Android we poll GitHub Releases for a newer `android-v*` tag and point the
// user at the APK. Returns null when up to date or on any error (callers stay
// silent — this is a best-effort nicety, not a critical path).

import { REPO_OWNER, REPO_NAME } from "./schema";
import { loadAuth } from "./github-api";

const API_BASE = "https://api.github.com";

export interface AndroidUpdate {
  /** Bare version, e.g. "1.4.2". */
  version: string;
  /** Release page to open for the download. */
  url: string;
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

function parseVer(v: string): number[] {
  return v
    .replace(/^android-v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/** Numeric semver-ish compare: is `a` strictly newer than `b`? */
function isNewer(a: string, b: string): boolean {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function checkAndroidUpdate(): Promise<AndroidUpdate | null> {
  const current = __APP_VERSION__;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Use the signed-in token if present (raises the API rate limit); the
  // releases list is public so an anonymous call works too.
  const token = loadAuth().token;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`,
    { headers },
  );
  if (!res.ok) return null;
  const releases = (await res.json()) as GhRelease[];

  // Highest published android-v* release.
  let best: { ver: string; url: string } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    if (!/^android-v/i.test(r.tag_name)) continue;
    const ver = r.tag_name.replace(/^android-v/i, "");
    if (!best || isNewer(ver, best.ver)) best = { ver, url: r.html_url };
  }

  return best && isNewer(best.ver, current)
    ? { version: best.ver, url: best.url }
    : null;
}
