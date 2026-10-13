#!/usr/bin/env python3
"""
Remove games from the catalogue - the command-line twin of /admin/remove.

Removing a game is not a one-time deletion. It adds a line to
data/blocklist.jsonl, a standing instruction that save_main() re-imposes on
every write (core/blocklist.py): the game leaves data/, is logged once in
scripts/removed_games.jsonl, and nothing - the browser extension, a refetch,
the discovery sweep - can bring it back. Restoring is done in /admin (Remove ->
Removed -> Restore), because it also has to clear the review queue's record.

  python scripts/delete_game.py 730 --reason not_a_game
  python scripts/delete_game.py https://store.steampowered.com/app/730/ 440 \\
      --reason duplicate --note "same game as 2357570" --apply
  python scripts/delete_game.py --list
  python scripts/delete_game.py --check        # validate the file (runs in CI)

Writes the same bytes /admin writes (held equal by
scripts/tests/fixtures/blocklist_golden.jsonl). The reason and the note are
PUBLIC: the blocklist is a file in a public repository. Without --apply,
data/ changes on the next pipeline run (pushing the blocklist starts one).

Run from the repository root (DATA_DIR is relative).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.blocklist import (
    REASONS, entry_problem, load_blocklist, make_entry, read_lines, serialize_entry,
)
from core.constants import BLOCKLIST_JSONL
from core.data_store import extract_appid, load_main, now_iso

# Same cap as /admin (web/shared/removal.ts MAX_REMOVE).
MAX_REMOVE = 100
MAX_NOTE = 300


def safe_stdout():
    """Game names are routinely non-Latin; a cp1252 console would mangle them."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def _appid_of(raw: str):
    raw = raw.strip()
    return raw if raw.isdigit() else extract_appid(raw)


def _append(lines: list[str], path: str = BLOCKLIST_JSONL) -> None:
    """Append whole lines, never re-serialising the ones already there."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    needs_newline = False
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as f:
            f.seek(-1, os.SEEK_END)
            needs_newline = f.read(1) != b"\n"
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        if needs_newline:
            f.write("\n")
        for line in lines:
            f.write(line + "\n")


def cmd_check(path: str = BLOCKLIST_JSONL) -> int:
    problems = 0
    seen: dict[str, int] = {}
    for lineno, line in enumerate(read_lines(path), 1):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"{path}:{lineno}: not JSON: {e}")
            problems += 1
            continue
        problem = entry_problem(entry)
        if problem:
            print(f"{path}:{lineno}: {problem}")
            problems += 1
            continue
        if entry["appid"] in seen:
            # Harmless (the last line wins) but never written by /admin.
            print(f"{path}:{lineno}: note: {entry['appid']} also on line {seen[entry['appid']]}")
        seen[entry["appid"]] = lineno
    print(f"{path}: {len(seen)} blocked game(s), {problems} problem(s).")
    return 1 if problems else 0


def cmd_list() -> int:
    entries = load_blocklist()
    if not entries:
        print(f"{BLOCKLIST_JSONL}: nothing blocked.")
        return 0
    for e in entries.values():
        note = f" - {e['note']}" if e.get("note") else ""
        print(f"{e['appid']:>10}  {e['blocked_at']}  {e['reason']:<13}  {e.get('name', '')}{note}")
    print(f"{len(entries)} blocked game(s).")
    return 0


def cmd_add(targets: list[str], reason: str, note: str, apply: bool) -> int:
    if reason not in REASONS:
        print(f"--reason must be one of: {', '.join(REASONS)}")
        return 2
    note = (note or "").strip()
    if len(note) > MAX_NOTE:
        print(f"--note is longer than {MAX_NOTE} characters.")
        return 2
    if reason == "other" and not note:
        print("--reason other needs a --note saying why.")
        return 2

    appids: list[str] = []
    for raw in targets:
        appid = _appid_of(raw)
        if not appid:
            print(f"Not a Steam appid or store link: {raw}")
            return 2
        if appid not in appids:
            appids.append(appid)
    if len(appids) > MAX_REMOVE:
        print(f"At most {MAX_REMOVE} games at once, as in /admin.")
        return 2

    blocked = load_blocklist()
    catalogue = {}
    for game in load_main():
        aid = extract_appid(game.get("link", ""))
        if aid:
            catalogue[aid] = game

    stamp = now_iso()
    lines = []
    for appid in appids:
        if appid in blocked:
            print(f"  skip {appid}: already blocked since {blocked[appid]['blocked_at']}")
            continue
        game = catalogue.get(appid)
        if game is None:
            # Every blocklist line must describe a game the catalogue held, so
            # that each removed-games log line describes a real removal.
            print(f"  skip {appid}: not in data/ (nothing to remove)")
            continue
        entry = make_entry(appid, str(game.get("name", "")), reason, note, stamp,
                           link=game.get("link"))
        lines.append(serialize_entry(entry))
        print(f"  block {appid}: {entry['name']}")

    if not lines:
        print("Nothing to add.")
        return 0
    _append(lines)
    print(f"Added {len(lines)} line(s) to {BLOCKLIST_JSONL}.")

    if apply:
        import remove_games
        return remove_games.main([])
    print("data/ changes on the next pipeline run (or run again with --apply).")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("targets", nargs="*", help="Steam appids or store links")
    ap.add_argument("--reason", choices=list(REASONS), help="why the games are removed (public)")
    ap.add_argument("--note", default="", help="optional detail, at most 300 characters (public)")
    ap.add_argument("--apply", action="store_true", help="take them out of data/ now")
    ap.add_argument("--list", action="store_true", help="print the blocklist")
    ap.add_argument("--check", action="store_true", help="validate data/blocklist.jsonl; exit 1 on a problem")
    args = ap.parse_args(argv)
    safe_stdout()

    if args.check:
        return cmd_check()
    if args.list:
        return cmd_list()
    if not args.targets:
        ap.print_help()
        return 2
    if not args.reason:
        print("--reason is required when removing games.")
        return 2
    return cmd_add(args.targets, args.reason, args.note, args.apply)


if __name__ == "__main__":
    sys.exit(main())
