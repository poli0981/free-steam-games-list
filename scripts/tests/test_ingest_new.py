"""
ingest_new.py reads scripts/temp_info.jsonl, which two producers append to (the
browser extension and /admin). These pin the lines that used to crash or
slip through: a link that is not text, and a game the maintainer removed.

Steam is never called: check_game_health and fetch_full are replaced.

Run from the repository root:  python -m pytest scripts/tests
"""
import json
import os

import pytest

import ingest_new
from core import data_store
from core.blocklist import make_entry, serialize_entry
from core.health_checker import HealthResult, OK


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    os.makedirs("scripts")
    data_store.save_main([{"link": "https://store.steampowered.com/app/1/", "name": "Existing"}],
                         apply_human_overrides=False)
    calls: list[str] = []

    def health(link, name="", client=None, details=None):
        appid = data_store.extract_appid(link)
        calls.append(appid)
        return HealthResult(OK, appid, f"Game {appid}", link,
                            data=details if details is not None else {"type": "game", "name": f"Game {appid}"})

    def fetch(game, client=None, prefetched_details=None):
        game["name"] = (prefetched_details or {}).get("name", game.get("name", ""))

    monkeypatch.setattr(ingest_new, "check_game_health", health)
    monkeypatch.setattr(ingest_new, "fetch_full", fetch)
    monkeypatch.setattr(ingest_new, "get_client", lambda: None)
    return calls


def _queue(*lines) -> None:
    with open(os.path.join("scripts", "temp_info.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        for line in lines:
            f.write((line if isinstance(line, str) else json.dumps(line)) + "\n")


def _appids() -> list[str]:
    return [data_store.extract_appid(g["link"]) for g in data_store.load_main()]


def test_parse_entries_turns_numbers_into_links_and_drops_nothing_silently():
    out = ingest_new.parse_entries([730, "440 ", {"link": 570}, {"link": ["x"]}, {"link": True}, {"name": "x"}, True])
    assert out == [
        {"link": "730"},
        {"link": "440"},
        {"link": "570"},
        {"link": ""},   # reported as an invalid line, not a crash
        {"link": ""},
    ]


def test_a_numeric_link_no_longer_crashes_the_run(repo):
    _queue({"link": 730}, {"link": ["not", "a", "link"]})
    ingest_new.main()
    assert _appids() == ["1", "730"]
    # The queue is cleared, so the next three-hourly run does not crash again.
    assert open(os.path.join("scripts", "temp_info.jsonl"), encoding="utf-8").read() == ""


def test_a_blocked_game_is_skipped_before_any_steam_request(repo):
    with open(os.path.join("data", "blocklist.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        f.write(serialize_entry(make_entry("440", "Blocked", "not_free", "", "2026-10-13T12:00:00Z")) + "\n")
    _queue('{"link":"https://store.steampowered.com/app/440/"}', '"https://store.steampowered.com/app/570/"')
    ingest_new.main()
    assert repo == ["570"]
    assert _appids() == ["1", "570"]


def test_a_free_dlc_demo_or_tool_is_refused_and_logged(repo, monkeypatch):
    real = ingest_new.check_game_health
    kinds = {"700": "dlc", "800": "demo", "900": "game", "950": None}

    def health(link, name="", client=None):
        appid = data_store.extract_appid(link)
        kind = kinds[appid]
        return real(link, name, client, details={"name": f"Game {appid}", **({"type": kind} if kind else {})})

    monkeypatch.setattr(ingest_new, "check_game_health", health)
    _queue(*({"link": a} for a in kinds))
    ingest_new.main()
    # No type at all (the HEAD fallback) is not evidence against the game.
    assert _appids() == ["1", "900", "950"]
    rows = data_store.load_jsonl(os.path.join("scripts", "removed_games.jsonl"))
    assert sorted((r["appid"], r["status_code"], r["reason"]) for r in rows) == [
        ("700", "not_a_game", "Not a game (Steam type: dlc)"),
        ("800", "not_a_game", "Not a game (Steam type: demo)"),
    ]
