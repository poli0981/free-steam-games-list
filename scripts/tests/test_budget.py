"""
A job's time budget and the rotations that keep a daily run the same size
however large the catalogue grows. These pin that a budget is opt-in, that a
loop past its deadline starts no further game, that only the store loops
pause, and that a growing cycle never brings a game's visits closer together.

Run from the repository root:  python -m pytest scripts/tests
"""
import zlib

import pytest

from core import budget, fetcher, rotation
from core.budget import Deadline


class Clock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(budget.time, "monotonic", c)
    return c


def _games(n: int) -> list[dict]:
    return [{"link": f"https://store.steampowered.com/app/{(i + 1) * 10}/", "name": f"G{i}"} for i in range(n)]


# ──────────── Deadline ────────────

@pytest.mark.parametrize("raw", [None, "", "0", "-5", "soon", "nan", "inf"])
def test_no_budget_means_no_deadline(monkeypatch, raw):
    if raw is None:
        monkeypatch.delenv(budget.ENV, raising=False)
    else:
        monkeypatch.setenv(budget.ENV, raw)
    assert Deadline.from_env() is None
    assert budget.expired(None) is False


def test_a_budget_counts_from_when_it_was_made(monkeypatch, clock):
    monkeypatch.setenv(budget.ENV, " 30 ")
    deadline = Deadline.from_env()
    assert deadline.minutes == 30
    clock.now += 29 * 60
    assert not budget.expired(deadline)
    clock.now += 60
    assert budget.expired(deadline) and deadline.used() == pytest.approx(1.0)


def test_the_report_warns_when_a_loop_ran_out_or_came_close(clock):
    lines: list[str] = []
    deadline = Deadline(10)
    clock.now += 60
    budget.report("Players", 5, 5, deadline, log=lines.append)
    clock.now += 7 * 60
    budget.report("Players", 5, 5, deadline, log=lines.append)
    budget.report("Players", 3, 5, deadline, log=lines.append)
    budget.report("Players", 5, 5, None, log=lines.append)
    assert not lines[0].startswith("::warning::") and "1 of 10" in lines[0]
    assert lines[1].startswith("::warning::") and "outgrowing" in lines[1]
    assert lines[2].startswith("::warning::") and "stopped after 3 of 5" in lines[2]
    assert len(lines) == 3


# ──────────── process_batch ────────────

def test_past_the_deadline_no_further_game_is_started(monkeypatch, clock):
    monkeypatch.setattr(fetcher.time, "sleep", lambda s: None)
    deadline = Deadline(1)
    seen: list[str] = []

    def fn(game):
        seen.append(game["name"])
        clock.now += 25          # the third game crosses the minute

    assert fetcher.process_batch(_games(10), fn, "Test", deadline=deadline) == 3
    assert seen == ["G0", "G1", "G2"]


def test_only_the_store_loops_pause_between_batches(monkeypatch):
    monkeypatch.setattr(fetcher, "BATCH_SIZE", 2)
    pauses: list[float] = []
    monkeypatch.setattr(fetcher.time, "sleep", pauses.append)
    assert fetcher.process_batch(_games(5), lambda g: None, "Store") == 5
    assert len(pauses) == 2                       # between the three batches, not after the last
    pauses.clear()
    assert fetcher.process_batch(_games(5), lambda g: None, "Players", pause=False) == 5
    assert pauses == []


def test_players_are_asked_without_pauses_in_a_daily_order(monkeypatch):
    monkeypatch.setattr(fetcher, "STEAM_API_KEY", "key")
    monkeypatch.setattr(fetcher.time, "sleep", lambda s: pytest.fail("the Web API loop slept"))
    asked: list[str] = []

    class Client:
        def fetch_player_count(self, appid, key):
            asked.append(appid)
            return 7

    monkeypatch.setattr(fetcher, "get_client", lambda: Client())
    games = [dict(g, type_game="online") for g in _games(120)]
    fetcher.update_players_only(games, day=100)
    first = list(asked)
    asked.clear()
    fetcher.update_players_only(games, day=101)
    assert sorted(first) == sorted(asked) and first != asked
    assert all(g["current_players"] == "7" for g in games)


def test_the_full_update_stops_at_its_deadline(monkeypatch, clock):
    monkeypatch.setattr(fetcher.time, "sleep", lambda s: None)
    monkeypatch.setattr(fetcher, "get_client", lambda: object())
    monkeypatch.setattr(fetcher.OverrideGuard, "load", classmethod(lambda cls: None))
    fetched: list[str] = []

    def fake_fetch(game, client=None, guard=None):
        fetched.append(game["name"])
        clock.now += 61

    monkeypatch.setattr(fetcher, "fetch_full", fake_fetch)
    fetcher.update_all_full(_games(4), deadline=Deadline(2))
    assert len(fetched) == 2


# ──────────── Rotation ────────────

@pytest.mark.parametrize("base, daily", [(7, 2000), (30, 500), (30, 400)])
def test_a_cycle_is_a_multiple_of_its_base_that_never_shrinks(base, daily):
    last = base
    for count in range(0, 100_001, 997):
        cycle = rotation.cycle_for(count, base, daily)
        assert cycle % base == 0 and cycle >= last
        assert count / cycle <= daily or cycle == base and count <= base * daily
        last = cycle


def test_the_cycle_stays_at_its_base_until_a_day_would_overflow():
    assert rotation.cycle_for(9847, 7, 2000) == 7
    assert rotation.cycle_for(14000, 7, 2000) == 7
    assert rotation.cycle_for(14001, 7, 2000) == 14
    assert rotation.cycle_for(12000, 30, 400) == 30
    assert rotation.cycle_for(12001, 30, 400) == 60
    assert rotation.cycle_for(5, 7, 0) == 7


def test_a_growing_cycle_keeps_every_visit_at_least_a_base_apart():
    base = 30
    for appid in ("730", "570", "2507950", "4219930"):
        crc = zlib.crc32(appid.encode())
        visits = []
        for day in range(20000, 20400):
            cycle = 30 if day < 20150 else 60 if day < 20300 else 90
            if rotation.due({"link": f"https://store.steampowered.com/app/{appid}/"}, cycle, day):
                visits.append(day)
        assert all(day % base == crc % base for day in visits)
        assert all(b - a >= base for a, b in zip(visits, visits[1:]))


def test_the_daily_order_holds_within_a_day_and_changes_the_next():
    games = _games(50)
    assert rotation.daily_order(games, 7) == rotation.daily_order(list(reversed(games)), 7)
    assert rotation.daily_order(games, 7) != rotation.daily_order(games, 8)
    assert sorted(g["name"] for g in rotation.daily_order(games, 8)) == sorted(g["name"] for g in games)
