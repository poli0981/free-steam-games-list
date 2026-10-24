"""
The leaderboards sample every online (top_online.py) or offline
(top_offline.py) game's player count through the keyed Web API, and
update_data.py refills incomplete records. These run each script end to end
against a fake client: they write their page and save through save_main(),
and the Web API loop never pauses.

Run from the repository root:  python -m pytest scripts/tests
"""
import os

import pytest

import top_offline
import top_online
import update_data
from core import budget, data_store, fetcher


def _rec(appid: str, type_game: str, players: str = "10") -> dict:
    return {"link": f"https://store.steampowered.com/app/{appid}/", "name": f"Game {appid}",
            "type_game": type_game, "status": "active", "current_players": players,
            "peak_today": players, "reviews": "90% (Very Positive)", "genre": "Action",
            "anti_cheat": "-", "notes": "Not reviewed yet", "last_updated": "2026-01-01T00:00:00Z"}


class Players:
    def __init__(self, counts):
        self.counts = counts

    def fetch_player_count(self, appid, key):
        return self.counts.get(appid)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    monkeypatch.delenv(budget.ENV, raising=False)
    monkeypatch.setattr(fetcher, "STEAM_API_KEY", "key")
    monkeypatch.setattr(fetcher.time, "sleep", lambda s: pytest.fail("the Web API loop slept"))
    data_store.save_main([_rec("10", "online"), _rec("20", "online"), _rec("30", "offline")],
                         apply_human_overrides=False)
    return monkeypatch


def _after() -> dict:
    return {data_store.extract_appid(g["link"]): g for g in data_store.load_main()}


def test_top_online_samples_the_online_games_and_writes_its_page(repo):
    repo.setattr(top_online, "STEAM_API_KEY", "key")
    repo.setattr(fetcher, "get_client", lambda: Players({"10": 50000, "20": 3}))
    top_online.main()
    page = open(os.path.join("games", "top-online.md"), encoding="utf-8").read()
    assert page.index("Game 10") < page.index("Game 20") and "Game 30" not in page
    after = _after()
    assert (after["10"]["current_players"], after["30"]["current_players"]) == ("50,000", "10")


def test_top_offline_samples_the_offline_games_and_writes_its_page(repo):
    repo.setattr(top_offline, "STEAM_API_KEY", "key")
    repo.setattr(fetcher, "get_client", lambda: Players({"30": 1200}))
    top_offline.main()
    page = open(os.path.join("games", "top-offline.md"), encoding="utf-8").read()
    assert "Game 30" in page and "Game 10" not in page
    assert _after()["30"]["current_players"] == "1,200"


def test_update_data_refills_only_incomplete_records(repo):
    refilled: list[str] = []
    repo.setattr(fetcher, "get_client", lambda: object())
    repo.setattr(fetcher.OverrideGuard, "load", classmethod(lambda cls: None))
    repo.setattr(fetcher, "fetch_full", lambda g, client=None, guard=None: refilled.append(g["link"]))
    update_data.main()
    assert len(refilled) == 3                     # the fixture's records lack most store fields
