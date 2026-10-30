"""
data/blocklist.jsonl is a standing instruction, applied inside save_main() like
the overrides. These pin what makes that safe: a blocked game is left out of
every write without touching the caller's list, it is logged exactly once, a
second save changes no byte, a damaged file cannot empty the catalogue, and the
line format is the one /admin writes.

Run from the repository root:  python -m pytest scripts/tests
"""
import json
import os

import pytest

from core import blocklist, data_store
from core.blocklist import BlocklistError, entry_problem, load_blocklist, make_entry, serialize_entry

GOLDEN = os.path.join(os.path.dirname(__file__), "fixtures", "blocklist_golden.jsonl")


def _game(appid: str, name: str = "") -> dict:
    return {
        "link": f"https://store.steampowered.com/app/{appid}/",
        "name": name or f"Game {appid}",
        "description": "",
        "genre": "Action",
    }


def _entry(appid: str, reason: str = "not_a_game", at: str = "2026-10-13T12:00:00Z", **kw) -> dict:
    return make_entry(appid, kw.pop("name", f"Game {appid}"), reason, kw.pop("note", ""), at)


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    """A scratch repository root (DATA_DIR and the log paths are relative)."""
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    os.makedirs("scripts")
    stamps = iter(f"2026-01-01T00:00:{s:02d}Z" for s in range(60))
    monkeypatch.setattr(data_store, "now_iso", lambda: next(stamps))
    return tmp_path


def _block(*entries: dict) -> None:
    with open(os.path.join("data", "blocklist.jsonl"), "a", encoding="utf-8", newline="\n") as f:
        for e in entries:
            f.write(serialize_entry(e) + "\n")


def _bytes(path: str) -> bytes:
    return open(path, "rb").read() if os.path.isfile(path) else b""


def _snapshot() -> dict:
    out = {}
    for name in sorted(os.listdir("data")):
        if name.endswith(".jsonl") or name == "index.json":
            out[name] = _bytes(os.path.join("data", name))
    out["removed"] = _bytes(os.path.join("scripts", "removed_games.jsonl"))
    return out


def _removed() -> list[dict]:
    return data_store.load_jsonl(os.path.join("scripts", "removed_games.jsonl"))


def _appids() -> list[str]:
    return [data_store.extract_appid(g["link"]) for g in data_store.load_main()]


def test_without_a_blocklist_nothing_changes(workdir):
    games = [_game("1"), _game("2")]
    data_store.save_main(games, apply_human_overrides=False)
    before = _snapshot()
    data_store.save_main(data_store.load_main(), apply_human_overrides=False)
    assert _snapshot() == before
    assert _removed() == []


def test_a_blocked_game_is_left_out_and_logged_once(workdir):
    _block(_entry("2", name="Second"))
    games = [_game("1"), _game("2", "Second"), _game("3")]
    data_store.save_main(games, apply_human_overrides=False)

    assert _appids() == ["1", "3"]
    # The caller's list is not touched: scripts keep positions into it.
    assert [g["link"] for g in games] == [_game(a)["link"] for a in ("1", "2", "3")]
    assert _removed() == [{
        "link": "https://store.steampowered.com/app/2/",
        "name": "Second",
        "appid": "2",
        "reason": "Removed by the maintainer: Not a game (DLC, demo, tool or soundtrack)",
        "status_code": "admin_removed",
        "removed_at": "2026-10-13T12:00:00Z",
    }]
    index = json.load(open(os.path.join("data", "index.json"), encoding="utf-8"))
    assert index["total"] == 2


def test_saving_again_changes_no_byte(workdir):
    _block(_entry("2"))
    data_store.save_main([_game("1"), _game("2")], apply_human_overrides=False)
    before = _snapshot()
    # The same list again (a script checkpointing), then a fresh load.
    data_store.save_main([_game("1"), _game("2")], apply_human_overrides=False)
    data_store.save_main(data_store.load_main(), apply_human_overrides=False)
    assert _snapshot() == before
    assert len(_removed()) == 1


def test_a_blocked_game_not_in_data_writes_nothing_from_save_main(workdir):
    _block(_entry("99"))
    data_store.save_main([_game("1")], apply_human_overrides=False)
    assert _removed() == []


def test_the_blocklist_applies_even_without_overrides(workdir):
    _block(_entry("1"))
    data_store.save_main([_game("1"), _game("2")], apply_human_overrides=True)
    assert _appids() == ["2"]


def test_too_many_drops_refuse_before_writing_anything(workdir):
    data_store.save_main([_game("1"), _game("2"), _game("3")], apply_human_overrides=False)
    before = _snapshot()
    _block(_entry("1"), _entry("2"), _entry("3"))
    with pytest.raises(BlocklistError):
        data_store.save_main(data_store.load_main(), apply_human_overrides=False, max_blocked_drop=2)
    after = _snapshot()
    after.pop("blocklist.jsonl")
    before.pop("blocklist.jsonl", None)
    assert after == before


def test_damaged_and_incomplete_lines_block_nothing(workdir, capsys):
    with open(os.path.join("data", "blocklist.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        f.write("{not json\n")
        f.write(json.dumps({"appid": "1", "reason": "not_free"}) + "\n")  # no blocked_at
        f.write(json.dumps({"appid": 2, "reason": "not_free", "blocked_at": "2026-10-13T12:00:00Z"}) + "\n")
        f.write(json.dumps({"appid": "3", "reason": "nope", "blocked_at": "2026-10-13T12:00:00Z"}) + "\n")
        f.write(json.dumps({"appid": "4", "reason": "not_free", "blocked_at": "2026-10-13T12:00:00.123Z"}) + "\n")
        f.write(serialize_entry(_entry("5")) + "\n")
    assert set(load_blocklist()) == {"5"}
    data_store.save_main([_game(a) for a in "12345"], apply_human_overrides=False)
    assert _appids() == ["1", "2", "3", "4"]
    assert "ignored" in capsys.readouterr().out


@pytest.mark.parametrize("appid, blocked_at", [
    ("５１１８７００", "2026-10-13T12:00:00Z"),       # full-width digits
    ("٥١١٨٧٠٠", "2026-10-13T12:00:00Z"),            # Arabic-Indic digits
    ("730\n", "2026-10-13T12:00:00Z"),               # `$` used to allow this
    ("730", "２０２６-10-13T12:00:00Z"),
    ("730", "2026-10-13T12:00:00Z\n"),
])
def test_a_line_removal_ts_would_refuse_blocks_nothing(appid, blocked_at):
    # web/shared/removal.ts reads these with JavaScript's ASCII-only digits
    # and an anchored `$`; both sides must refuse the same lines.
    entry = {"appid": appid, "link": "", "name": "", "reason": "not_free", "note": "",
             "blocked_at": blocked_at, "by": "admin"}
    assert entry_problem(entry) is not None
    assert entry_problem({**entry, "appid": "730", "blocked_at": "2026-10-13T12:00:00Z"}) is None


def test_blocking_again_later_logs_the_new_removal(workdir):
    _block(_entry("2", at="2026-10-13T12:00:00Z"))
    data_store.save_main([_game("1"), _game("2")], apply_human_overrides=False)
    # Restored (line deleted), re-added, blocked again later.
    os.remove(os.path.join("data", "blocklist.jsonl"))
    data_store.save_main([_game("1"), _game("2")], apply_human_overrides=False)
    _block(_entry("2", at="2026-11-01T08:00:00Z"))
    data_store.save_main(data_store.load_main(), apply_human_overrides=False)
    rows = _removed()
    assert len(rows) == 1 and rows[0]["removed_at"] == "2026-11-01T08:00:00Z"


def test_a_later_purge_line_keeps_winning(workdir):
    later = {"link": "https://store.steampowered.com/app/2/", "name": "Game 2", "appid": "2",
             "reason": "No longer free-to-play", "status_code": "not_free",
             "removed_at": "2026-12-01T00:00:00Z"}
    data_store.save_jsonl(os.path.join("scripts", "removed_games.jsonl"), [later])
    before = _bytes(os.path.join("scripts", "removed_games.jsonl"))
    assert data_store.log_admin_removals([blocklist.removed_row(_entry("2"))]) == 0
    assert _bytes(os.path.join("scripts", "removed_games.jsonl")) == before


def test_an_override_of_a_blocked_game_is_kept(workdir):
    os.makedirs(os.path.join("data", "overrides"))
    path = os.path.join("data", "overrides", "2.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"schema": 1, "appid": "2", "fields": {"genre": {"value": "Puzzle", "was": "Action"}}}, fh)
    _block(_entry("2"))
    data_store.save_main([_game("1"), _game("2")])
    assert os.path.isfile(path)
    assert _appids() == ["1"]


def test_the_golden_lines_round_trip_byte_for_byte():
    # web/shared/removal.test.ts reads the same file: both serialisers must
    # reproduce every line exactly, escaping included.
    for line in open(GOLDEN, encoding="utf-8").read().split("\n"):
        if line:
            assert serialize_entry(json.loads(line)) == line


def test_notes_are_one_line():
    e = make_entry("1", "A\u2028B", "other", " first\nsecond\t\u0001 third ", "2026-10-13T12:00:00Z")
    assert e["note"] == "first second third"
    assert e["name"] == "A B"
    assert e["by"] == "admin"
    with pytest.raises(ValueError):
        make_entry("1", "x", "bogus", "", "2026-10-13T12:00:00Z")
