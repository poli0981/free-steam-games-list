"""
delete_game.py (the CLI twin of /admin/remove) and remove_games.py (what the
ingest workflow runs to apply the blocklist).

Run from the repository root:  python -m pytest scripts/tests
"""
import json
import os

import pytest

import delete_game
import remove_games
from core import data_store
from core.blocklist import load_blocklist, removed_row


def _game(appid: str, name: str = "") -> dict:
    return {"link": f"https://store.steampowered.com/app/{appid}/", "name": name or f"Game {appid}",
            "description": "", "genre": "Action"}


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    os.makedirs("scripts")
    monkeypatch.setattr(data_store, "now_iso", lambda: "2026-10-13T12:00:00Z")
    monkeypatch.setattr(delete_game, "now_iso", lambda: "2026-10-13T12:00:00Z")
    data_store.save_main([_game("10", "Ten"), _game("20", "Twenty"), _game("30")], apply_human_overrides=False)
    return tmp_path


def _lines() -> list[str]:
    path = os.path.join("data", "blocklist.jsonl")
    return open(path, encoding="utf-8").read().splitlines() if os.path.isfile(path) else []


def _appids() -> list[str]:
    return [data_store.extract_appid(g["link"]) for g in data_store.load_main()]


def test_adds_one_line_per_game_in_the_admin_format(repo):
    assert delete_game.main(["10", "https://store.steampowered.com/app/20/", "--reason", "duplicate",
                             "--note", "same as 30"]) == 0
    assert _lines() == [
        '{"appid":"10","link":"https://store.steampowered.com/app/10/","name":"Ten","reason":"duplicate",'
        '"note":"same as 30","blocked_at":"2026-10-13T12:00:00Z","by":"admin"}',
        '{"appid":"20","link":"https://store.steampowered.com/app/20/","name":"Twenty","reason":"duplicate",'
        '"note":"same as 30","blocked_at":"2026-10-13T12:00:00Z","by":"admin"}',
    ]
    # Without --apply, data/ is untouched until the pipeline runs.
    assert _appids() == ["10", "20", "30"]


def test_skips_what_is_blocked_or_absent_and_never_rewrites_lines(repo):
    delete_game.main(["10", "--reason", "broken"])
    first = _lines()
    assert delete_game.main(["10", "99", "--reason", "broken"]) == 0
    assert _lines() == first


def test_refuses_bad_input(repo):
    assert delete_game.main(["10", "--reason", "other"]) == 2  # needs a note
    assert delete_game.main(["not-a-game", "--reason", "broken"]) == 2
    assert delete_game.main(["10"]) == 2  # no reason
    assert _lines() == []


def test_apply_removes_and_logs(repo):
    assert delete_game.main(["20", "--reason", "not_free", "--apply"]) == 0
    assert _appids() == ["10", "30"]
    rows = data_store.load_jsonl(os.path.join("scripts", "removed_games.jsonl"))
    assert [(r["appid"], r["status_code"], r["removed_at"]) for r in rows] == [
        ("20", "admin_removed", "2026-10-13T12:00:00Z")]


def test_check_fails_on_a_line_that_would_block_nothing(repo, capsys):
    delete_game.main(["10", "--reason", "broken"])
    assert delete_game.main(["--check"]) == 0
    with open(os.path.join("data", "blocklist.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"appid": "20", "reason": "broken"}) + "\n")
    assert delete_game.main(["--check"]) == 1
    assert "blocked_at" in capsys.readouterr().out


def test_appends_after_a_file_without_a_final_newline(repo):
    delete_game.main(["10", "--reason", "broken"])
    path = os.path.join("data", "blocklist.jsonl")
    text = open(path, encoding="utf-8").read().rstrip("\n")
    open(path, "w", encoding="utf-8", newline="\n").write(text)
    delete_game.main(["20", "--reason", "broken"])
    assert len(_lines()) == 2 and set(load_blocklist()) == {"10", "20"}


def test_remove_games_applies_then_is_a_no_op(repo):
    delete_game.main(["30", "--reason", "broken"])
    assert remove_games.main([]) == 0
    assert _appids() == ["10", "20"]
    snapshot = {p: open(os.path.join("data", p), "rb").read() for p in os.listdir("data") if p != "overrides"}
    log = open(os.path.join("scripts", "removed_games.jsonl"), "rb").read()
    assert remove_games.main([]) == 0
    assert {p: open(os.path.join("data", p), "rb").read() for p in os.listdir("data") if p != "overrides"} == snapshot
    assert open(os.path.join("scripts", "removed_games.jsonl"), "rb").read() == log


def test_remove_games_heals_a_missing_log_line(repo):
    delete_game.main(["30", "--reason", "broken", "--apply"])
    # A job whose commit left the log out: the game is gone, the line is not.
    os.remove(os.path.join("scripts", "removed_games.jsonl"))
    assert remove_games.main([]) == 0
    rows = data_store.load_jsonl(os.path.join("scripts", "removed_games.jsonl"))
    assert rows == [removed_row(load_blocklist()["30"])]


def test_remove_games_respects_the_mass_drop_limit(repo):
    delete_game.main(["10", "20", "30", "--reason", "broken"])
    from core.blocklist import BlocklistError
    with pytest.raises(BlocklistError):
        remove_games.main(["--max-drop", "2"])
    assert _appids() == ["10", "20", "30"]
    assert remove_games.main(["--max-drop", "3"]) == 0
    assert _appids() == []
