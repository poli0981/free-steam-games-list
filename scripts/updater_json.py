#!/usr/bin/env python3
"""
Point a desktop release's latest.json at the release's own downloads.

tauri-action v1 writes each artefact's API URL into latest.json
(https://api.github.com/repos/<repo>/releases/assets/<id>). The desktop
updater feed (/api/updates/desktop, web/worker/routes/updates.ts) accepts only
https://github.com/<repo>/releases/download/<tag>/<file> and answers 204 -
"no update" - to anything else, so a release published with the API URLs is
never offered to an installed app. desktop-v2.2.1 was the first release built
with v1 and had to be fixed by hand.

release-desktop.yml runs this once every platform has added its entries:

  python scripts/updater_json.py <latest.json> <assets.json> <sig dir> <tag> <out>

assets.json is the release's assets as [{"id": ..., "name": ...}]; the sig dir
holds its .sig files. Every entry's signature must be the content of the .sig
of the file its new URL names. An entry that already points at this release's
download is kept, so a second run changes nothing. Standard library only.
"""
import json
import re
import sys
from pathlib import Path

REPO = "poli0981/free-steam-games-list"
_API_URL = re.compile(rf"^https://api\.github\.com/repos/{re.escape(REPO)}/releases/assets/(\d+)$")


def download_url(tag: str, name: str) -> str:
    return f"https://github.com/{REPO}/releases/download/{tag}/{name}"


def rewrite(doc: dict, tag: str, names_by_id: dict, signatures: dict) -> dict:
    """latest.json with every URL on this release's downloads.

    Raises ValueError for anything the updater feed would refuse anyway: a
    version that is not the tag's, no platform, an asset of another release,
    a URL of any other shape, or a signature that is not its file's .sig.
    """
    version = str(doc.get("version", "")).removeprefix("v")
    if f"desktop-v{version}" != tag:
        raise ValueError(f"latest.json is version {doc.get('version')!r}, not {tag}")
    platforms = doc.get("platforms") or {}
    if not platforms:
        raise ValueError("latest.json lists no platform")
    prefix = download_url(tag, "")
    out = {}
    for key, entry in platforms.items():
        url = entry.get("url", "")
        m = _API_URL.match(url)
        if m:
            name = names_by_id.get(m.group(1))
            if name is None:
                raise ValueError(f"{key}: asset {m.group(1)} is not one of {tag}'s")
        elif url.startswith(prefix):
            name = url[len(prefix):]
        else:
            raise ValueError(f"{key}: unexpected URL {url}")
        signature = (entry.get("signature") or "").strip()
        if not signature or signature != (signatures.get(name) or "").strip():
            raise ValueError(f"{key}: the signature is not the content of {name}.sig")
        out[key] = {**entry, "url": download_url(tag, name)}
    return {**doc, "platforms": out}


def main(argv=None) -> int:
    latest, assets, sig_dir, tag, out = argv if argv is not None else sys.argv[1:]
    doc = json.loads(Path(latest).read_text(encoding="utf-8"))
    names_by_id = {str(a["id"]): a["name"] for a in json.loads(Path(assets).read_text(encoding="utf-8"))}
    signatures = {p.name.removesuffix(".sig"): p.read_text(encoding="utf-8") for p in Path(sig_dir).glob("*.sig")}
    fixed = rewrite(doc, tag, names_by_id, signatures)
    Path(out).write_text(json.dumps(fixed, indent=2) + "\n", encoding="utf-8", newline="\n")
    for key, entry in fixed["platforms"].items():
        print(f"{key:24} {entry['url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
