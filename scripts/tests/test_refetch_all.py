"""
refetch_all.py clears what Steam can give back and keeps what a person
decided, one game at a time: a game appdetails does not answer for, or the
ones a part cut short by its budget never reached, stay exactly as they were.
Run from the repository root:  python -m pytest scripts/tests
"""
import os

import pytest

import refetch_all
from core import budget, data_store


def test_clear_fetchable_resets_a_default_to_the_skeleton_s_value():
    # "-" used to become "", a value nothing else writes, which the old VAC
    # detection then checked against only one category.
    game = {"anti_cheat": "-", "anti_cheat_note": "", "is_kernel_ac": None, "genre": "Uncategorized"}
    refetch_all.clear_fetchable(game)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == ("-", "", None)
    assert game["genre"] == ""


def test_clear_fetchable_keeps_a_decision():
    game = {"anti_cheat": "BattlEye", "anti_cheat_note": "BattlEye [Kernel]", "is_kernel_ac": True, "genre": "FPS"}
    refetch_all.clear_fetchable(game)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"], game["genre"]) == \
        ("BattlEye", "BattlEye [Kernel]", True, "FPS")


# ──────────── In parts, game by game ────────────


def _rec(appid: str, **fields) -> dict:
    base = {"link": f"https://store.steampowered.com/app/{appid}/", "name": f"Game {appid}",
            "description": "kept", "tags": ["FPS"], "reviews": "50% (Mixed)", "genre": "FPS",
            "anti_cheat": "-", "anti_cheat_note": "", "is_kernel_ac": None, "type_game": "online",
            "notes": "Not reviewed yet", "last_updated": "2026-01-01T00:00:00Z"}
    base.update(fields)
    return base


class _Client:
    def __init__(self, failing=()):
        self.failing = set(failing)
        self.asked: list[str] = []

    def fetch_app_details_full(self, appid):
        self.asked.append(appid)
        if appid in self.failing:
            return ("network_error", None)
        return ("ok", {"name": f"Fresh {appid}", "is_free": True})


@pytest.mark.parametrize("text, part", [("1/1", (1, 1)), (" 3 / 8 ", (3, 8)), ("8/8", (8, 8))])
def test_a_part_is_read(text, part):
    assert refetch_all.parse_part(text) == part


@pytest.mark.parametrize("text", ["0/4", "5/4", "1/0", "x", "", "1/2/3"])
def test_a_bad_part_is_refused(text):
    with pytest.raises(Exception):
        refetch_all.parse_part(text)


def test_the_parts_split_the_catalogue():
    games = [_rec(str(10 * i)) for i in range(1, 501)]
    counts = [sum(refetch_all.in_part(g, (k, 8)) for g in games) for k in range(1, 9)]
    assert sum(counts) == len(games) and min(counts) > 0


def test_a_game_appdetails_does_not_answer_for_is_left_as_it_was(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(refetch_all, "fetch_full",
                        lambda g, client=None, prefetched_details=None, guard=None: calls.append(g["link"]))
    game = _rec("730")
    before = dict(game)
    assert refetch_all.refetch_one(game, _Client(failing={"730"}), None) is False
    assert game == before and calls == []


def test_a_game_is_cleared_and_fetched_on_a_copy(monkeypatch):
    def fake_fetch(g, client=None, prefetched_details=None, guard=None):
        assert g["description"] == "" and g["reviews"] == "N/A"   # cleared before the fetch
        g["name"] = prefetched_details["name"]

    monkeypatch.setattr(refetch_all, "fetch_full", fake_fetch)
    game = _rec("730", anti_cheat="BattlEye")
    assert refetch_all.refetch_one(game, _Client(), None) is True
    assert game["name"] == "Fresh 730" and game["anti_cheat"] == "BattlEye"


def test_a_cut_part_leaves_every_other_game_alone_and_resumes_oldest_first(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    games = [_rec(str(10 * i), last_updated=f"2026-01-{i:02d}T00:00:00Z") for i in range(1, 9)]
    data_store.save_main(games, apply_human_overrides=False)
    client = _Client()
    monkeypatch.setattr(refetch_all, "get_client", lambda: client)
    monkeypatch.setattr(refetch_all.OverrideGuard, "load", classmethod(lambda cls: None))
    monkeypatch.setattr(refetch_all, "STEAM_API_KEY", "")

    clock = [0.0]
    monkeypatch.setattr(budget.time, "monotonic", lambda: clock[0])

    def fake_fetch(g, client=None, prefetched_details=None, guard=None):
        clock[0] += 40
        g["name"] = prefetched_details["name"]
        g["last_updated"] = "2026-10-23T00:00:00Z"

    monkeypatch.setattr(refetch_all, "fetch_full", fake_fetch)
    monkeypatch.setattr("core.fetcher.time.sleep", lambda s: None)
    monkeypatch.setenv(budget.ENV, "1")
    refetch_all.main(["--part", "1/1"])
    after = {data_store.extract_appid(g["link"]): g for g in data_store.load_main()}
    assert client.asked == ["10", "20"]                      # the two oldest, then the budget ran out
    assert after["10"]["name"] == "Fresh 10" and after["30"]["name"] == "Game 30"
    assert after["30"]["description"] == "kept"              # never cleared
