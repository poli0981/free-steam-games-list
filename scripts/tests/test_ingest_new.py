"""
ingest_new.py reads scripts/temp_info.jsonl, which /admin appends to (and a
pull request may). A line is a store link and nothing else. These pin the lines
that used to crash or slip through: a link that is not text, a line carrying
fields of its own, and a game the maintainer removed.

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

    def fetch(game, client=None, prefetched_details=None, **_):
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


def test_parse_entries_keeps_only_the_link():
    line = {"link": "730", "genre": "MOBA", "anti_cheat": "VAC", "notes": "x", "name": "Fake",
            "status": "removed", "last_updated": "2030-01-01T00:00:00Z"}
    assert ingest_new.parse_entries([line]) == [{"link": "730"}]


def test_a_line_s_own_fields_never_reach_the_record(repo):
    # The retired browser extension sent whole records; its merge let one line
    # decide any field, a manual one or the record's status alike.
    _queue({"link": "730", "genre": "MOBA", "safe": "y", "notes": "CS2 babyyy",
            "status": "delisted", "is_dead": True})
    ingest_new.main()
    game = next(g for g in data_store.load_main() if g["link"].endswith("/730/"))
    assert game["name"] == "Game 730"
    assert game["genre"] == "" and game["safe"] == "?" and game["notes"] == ""
    assert game["status"] == "active" and game["is_dead"] is False


def test_a_numeric_link_no_longer_crashes_the_run(repo):
    _queue({"link": 730}, {"link": ["not", "a", "link"]})
    ingest_new.main()
    assert _appids() == ["1", "730"]
    # The queue is cleared, so the next three-hourly run does not crash again.
    assert open(os.path.join("scripts", "temp_info.jsonl"), encoding="utf-8").read() == ""


@pytest.mark.parametrize("raw, link", [
    # A non-English store page: the slug is the name, percent-encoded or raw.
    ("https://store.steampowered.com/app/5118700/%E3%83%88%E3%83%AD%E3%82%A4/",
     "https://store.steampowered.com/app/5118700/"),
    ("https://store.steampowered.com/app/5118700/トロイメライノクターン/?l=japanese",
     "https://store.steampowered.com/app/5118700/"),
    # A Japanese keyboard types full-width digits; NFKC reads them as ASCII.
    ("５１１８７００", "https://store.steampowered.com/app/5118700/"),
    ("store.steampowered.com/app/５１１８７００/", "https://store.steampowered.com/app/5118700/"),
    # Any other script's digits are refused, never stored: a non-ASCII appid
    # would stop every refresh (rotation.slice_of encodes it as ASCII).
    ("٥١١٨٧٠٠", None),
    ("https://store.steampowered.com/app/٥١١٨٧٠٠/", None),
    ("https://store.steampowered.com/app/730٤/", None),
])
def test_a_link_in_any_script_becomes_the_canonical_one_or_nothing(raw, link):
    assert data_store.normalize_link(raw) == link


def test_extract_appid_reads_ascii_digits_only():
    assert data_store.extract_appid("https://store.steampowered.com/app/730/") == "730"
    assert data_store.extract_appid("https://store.steampowered.com/app/５/") is None
    assert data_store.extract_appid("https://store.steampowered.com/app/730٤/") is None


def test_a_link_in_other_digits_is_refused_and_the_run_goes_on(repo):
    _queue({"link": "٥١١٨٧٠٠"}, {"link": "５１１８７００"})
    ingest_new.main()
    assert _appids() == ["1", "5118700"]
    assert repo == ["5118700"]
    # Not logged: a row without an appid is dropped by dedup_removed().
    assert data_store.load_jsonl(os.path.join("scripts", "removed_games.jsonl")) == []


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
