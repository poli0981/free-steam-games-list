#!/usr/bin/env python3
"""Create, inspect and retire human overrides for a game.

An override is a standing instruction, not a one-time edit: it lives in
`data/overrides/<appid>.json` and `save_main()` re-imposes it on every write to
data/, so it survives `refetch_all.py` and `normalize_genres.py --apply`. See
scripts/core/overrides.py for why that is necessary.

This command only writes the override file. Nothing changes in data/ until the
next pipeline run — or until you pass --apply, which rewrites data/ now.

    # what does the catalogue currently say?
    python scripts/edit_game.py 730 --show

    # fix a genre, with a reason (the reason is kept, and shows in git log)
    python scripts/edit_game.py 730 --set genre="FPS" --reason "Steam's genre is too coarse"

    # several fields at once
    python scripts/edit_game.py 730 --set type_game=online --set safe=y

    # undo: restores the pre-edit value, then permanently no-ops
    python scripts/edit_game.py 730 --retire genre

    # write the change into data/ immediately instead of waiting for a run
    python scripts/edit_game.py 730 --set notes="Community servers only" --apply

    python scripts/edit_game.py --list     # every override
    python scripts/edit_game.py --check    # validate them all (CI-friendly)
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.constants import MANUAL_FIELDS
from core.data_store import load_main, save_main, extract_appid, now_iso
from core.overrides import (
    OVERRIDE_SCHEMA, load_overrides, override_path, save_override,
    validate_value,
)


def safe_stdout():
    """Game names and note markers are non-Latin; a cp1252 console would die."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def coerce(field: str, raw: str):
    """Turn a command-line string into the value the record stores."""
    if field == "is_kernel_ac":
        low = raw.strip().lower()
        if low in ("true", "yes", "y", "1"):
            return True
        if low in ("false", "no", "n", "0"):
            return False
        if low in ("null", "none", ""):
            return None
        return raw
    return raw


def find_game(games, appid):
    for g in games:
        if extract_appid(g.get("link", "")) == appid:
            return g
    return None


def cmd_list():
    docs = load_overrides()
    if not docs:
        print("no overrides")
        return 0
    print(f"{len(docs)} override(s):")
    for appid, doc in sorted(docs.items()):
        live = doc.get("fields") or {}
        gone = doc.get("retired") or {}
        name = doc.get("name") or "?"
        print(f"  {appid:>8}  {name[:44]:<44} {len(live)} active, {len(gone)} retired")
        for f, e in sorted(live.items()):
            print(f"           {f} = {e.get('value')!r}  (was {e.get('was')!r})")
    return 0


def cmd_check():
    """Validate every override without touching data/. Exit 1 on any problem."""
    docs = load_overrides()
    problems = []
    known = {extract_appid(g.get("link", "")) for g in load_main()}
    for appid, doc in sorted(docs.items()):
        if doc.get("schema") != OVERRIDE_SCHEMA:
            problems.append(f"{appid}: schema is {doc.get('schema')!r}, expected {OVERRIDE_SCHEMA}")
        if doc.get("appid") != appid:
            problems.append(f"{appid}: appid field is {doc.get('appid')!r}, does not match filename")
        if appid not in known:
            # Not an error: the game may be delisted and may come back.
            print(f"  note: {appid} has no record in data/ (orphan, kept)")
        for field, entry in (doc.get("fields") or {}).items():
            if not isinstance(entry, dict):
                problems.append(f"{appid}.{field}: entry is not an object")
                continue
            why = validate_value(field, entry.get("value"))
            if why:
                problems.append(f"{appid}.{field}: {why}")
    print(f"checked {len(docs)} override(s)")
    for p in problems:
        print(f"  PROBLEM {p}")
    return 1 if problems else 0


def cmd_show(appid):
    game = find_game(load_main(), appid)
    if not game:
        print(f"{appid}: not in data/")
        return 1
    print(f"{appid}  {game.get('name')}")
    print(f"  {game.get('link')}")
    for f in sorted(MANUAL_FIELDS):
        print(f"  {f:<16} {game.get(f)!r}")
    doc = load_overrides().get(appid)
    if doc:
        print("  --- override ---")
        for f, e in sorted((doc.get("fields") or {}).items()):
            print(f"  {f:<16} {e.get('value')!r}  (was {e.get('was')!r}, by {e.get('set_by')})")
        for f, e in sorted((doc.get("retired") or {}).items()):
            print(f"  {f:<16} RETIRED, restores {e.get('was')!r}")
    else:
        print("  (no override)")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("appid", nargs="?", help="Steam appid")
    ap.add_argument("--set", action="append", default=[], metavar="FIELD=VALUE",
                    help="set an override; repeatable")
    ap.add_argument("--retire", action="append", default=[], metavar="FIELD",
                    help="undo an override, restoring the pre-edit value")
    ap.add_argument("--reason", default="", help="why (kept with the entry)")
    ap.add_argument("--by", default=os.environ.get("OVERRIDE_ACTOR", "local"),
                    help="who (defaults to $OVERRIDE_ACTOR)")
    ap.add_argument("--show", action="store_true", help="print current values")
    ap.add_argument("--list", action="store_true", help="list every override")
    ap.add_argument("--check", action="store_true", help="validate all overrides")
    ap.add_argument("--apply", action="store_true",
                    help="rewrite data/ now instead of waiting for a pipeline run")
    args = ap.parse_args()
    safe_stdout()

    if args.list:
        return cmd_list()
    if args.check:
        return cmd_check()
    if not args.appid:
        ap.error("appid is required unless --list or --check")
    if not args.appid.isdigit():
        ap.error("appid must be digits")
    if args.show:
        return cmd_show(args.appid)
    if not args.set and not args.retire:
        ap.error("nothing to do: pass --set, --retire, --show, --list or --check")

    games = load_main()
    game = find_game(games, args.appid)
    if not game:
        print(f"ERROR: {args.appid} is not in data/. Add the game first.")
        return 1

    doc = load_overrides().get(args.appid) or {
        "schema": OVERRIDE_SCHEMA,
        "appid": args.appid,
        "link": game.get("link", ""),
        "name": game.get("name", ""),
        "fields": {},
        "retired": {},
    }
    doc.setdefault("fields", {})
    doc.setdefault("retired", {})
    # Keep the human-readable denormalised copies fresh so a diff stays legible.
    doc["name"] = game.get("name", doc.get("name", ""))
    doc["link"] = game.get("link", doc.get("link", ""))

    now = now_iso()

    for pair in args.set:
        if "=" not in pair:
            print(f"ERROR: --set expects FIELD=VALUE, got {pair!r}")
            return 2
        field, raw = pair.split("=", 1)
        field = field.strip()
        value = coerce(field, raw)
        why = validate_value(field, value)
        if why:
            print(f"ERROR: {field}: {why}")
            return 2
        # `was` is captured from the CURRENT stored value the first time a
        # field is overridden, and never overwritten afterwards - it is what
        # --retire restores, so it must stay the pre-human value.
        was = doc["fields"].get(field, {}).get("was", game.get(field))
        doc["fields"][field] = {
            "value": value,
            "was": was,
            "set_by": args.by,
            "set_at": now,
            "reason": args.reason,
        }
        doc["retired"].pop(field, None)
        print(f"  set {field} = {value!r}  (was {was!r})")

    for field in args.retire:
        field = field.strip()
        entry = doc["fields"].pop(field, None)
        if not entry:
            print(f"  {field}: no active override, nothing to retire")
            continue
        doc["retired"][field] = {
            "value": entry.get("value"),
            "was": entry.get("was"),
            "retired_by": args.by,
            "retired_at": now,
        }
        print(f"  retired {field}; will restore {entry.get('was')!r}")

    if not doc["fields"] and not doc["retired"]:
        # Nothing left to say. Removing the file is safe only in this state.
        path = override_path(args.appid)
        if os.path.exists(path):
            os.remove(path)
            print(f"  removed {path} (no entries left)")
        return 0

    path = save_override(doc)
    print(f"wrote {path}")

    if args.apply:
        # save_main() applies overrides itself and prints what it did; calling
        # apply_overrides() here as well would just do the work twice.
        save_main(games)
        print("data/ rewritten")
    else:
        print("data/ unchanged - the next pipeline run applies it "
              "(or re-run with --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
