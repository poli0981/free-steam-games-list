"""
purge_unhealthy.py removes a game only when two of Steam's answers agree: the
store API's screen of the whole catalogue, and appdetails for each game it
flags. These pin the rules that make a daily, unattended removal safe: what
nobody answered is never "gone", appdetails' unavailable is asked twice,
blocklisted games are not asked about, a broken answer stops the run before
anything is written, and removals are logged as the Worker's reconcile reads
them.

Steam is never called: the client and appdetails are fakes. Run from the
repository root:  python -m pytest scripts/tests
"""
import json
import os

import pytest

import purge_unhealthy as pu
from core import budget, data_store
from core.health_checker import (
    NETWORK_ERROR, NOT_FREE, OK, UNAVAILABLE, HealthResult,
)

OLD = "2026-01-01T00:00:00Z"
FREE = {"visible": True, "is_free": True, "release": {"steam_release_date": 1}}


def _rec(appid: str, name: str = "") -> dict:
    return {"link": f"https://store.steampowered.com/app/{appid}/", "name": name or f"Game {appid}",
            "type_game": "online", "notes": "Not reviewed yet", "last_updated": OLD}


def _item(appid: str, **fields) -> dict:
    return dict(FREE, id=int(appid), success=1, **fields)


class FakeClient:
    """GetItems items by appid (absent: unknown to Steam) and failed appids."""

    def __init__(self, items=None, failed=()):
        self.items, self.failed = items or {}, set(failed)
        self.asked: list[list[str]] = []

    def fetch_items(self, appids, data_request, give_up_after=10):
        assert data_request == {"include_release": True}
        self.asked.append(list(appids))
        return ({a: self.items[a] for a in appids if a in self.items and a not in self.failed},
                {a for a in appids if a in self.failed})


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    os.makedirs("scripts")
    monkeypatch.delenv(budget.ENV, raising=False)
    sleeps: list[float] = []
    monkeypatch.setattr(pu.time, "sleep", sleeps.append)
    answers: dict[str, list[str]] = {}
    health_calls: list[str] = []

    def fake_health(link, name="", client=None):
        appid = data_store.extract_appid(link)
        health_calls.append(appid)
        status = answers[appid].pop(0)
        return HealthResult(status, appid, name, link)

    monkeypatch.setattr(pu, "check_game_health", fake_health)
    monkeypatch.setattr(pu, "blocked_appids", lambda: set())

    class Repo:
        def run(self, records=None, client=None, health=None, argv=()):
            if records is not None:
                data_store.save_main(records, apply_human_overrides=False)
            answers.clear()
            answers.update({a: list(v) for a, v in (health or {}).items()})
            monkeypatch.setattr(pu, "get_client", lambda: client)
            code = pu.main(list(argv))
            return code, {data_store.extract_appid(g["link"]) for g in data_store.load_main()}

    r = Repo()
    r.sleeps, r.health_calls = sleeps, health_calls
    r.block = lambda ids: monkeypatch.setattr(pu, "blocked_appids", lambda: set(ids))
    return r


def _removed() -> list[dict]:
    path = os.path.join("scripts", "removed_games.jsonl")
    return [json.loads(line) for line in open(path, encoding="utf-8")] if os.path.exists(path) else []


def _bytes() -> dict:
    files = [os.path.join("data", n) for n in sorted(os.listdir("data")) if n.endswith((".jsonl", ".json"))]
    files += [os.path.join("scripts", n) for n in sorted(os.listdir("scripts"))]
    return {f: open(f, "rb").read() for f in files}


def test_an_empty_catalogue_asks_nothing(repo):
    client = FakeClient()
    assert repo.run(None, client) == (0, set())
    assert client.asked == []


def test_a_healthy_catalogue_asks_appdetails_nothing(repo):
    client = FakeClient(items={"730": _item("730"), "570": _item("570")})
    code, live = repo.run([_rec("730"), _rec("570")], client)
    assert (code, live) == (0, {"730", "570"})
    assert repo.health_calls == [] and _removed() == []


def test_a_game_both_answers_flag_is_removed_and_logged(repo):
    client = FakeClient(items={"730": _item("730"), "4991340": _item("4991340", unlisted=True, is_free=False)})
    code, live = repo.run([_rec("730"), _rec("4991340", "Might & Poison Mushroom")], client,
                          health={"4991340": [NOT_FREE]})
    assert (code, live) == (0, {"730"})
    [row] = _removed()
    assert (row["appid"], row["status_code"], row["reason"]) == ("4991340", "not_free", "No longer free-to-play")
    assert row["name"] == "Might & Poison Mushroom" and row["removed_at"]


def test_a_flag_appdetails_contradicts_is_kept(repo):
    client = FakeClient(items={"2878670": _item("2878670", is_free=False)})
    code, live = repo.run([_rec("2878670", "Spoop Troop")], client, health={"2878670": [OK]})
    assert (code, live) == (0, {"2878670"}) and _removed() == []


def test_unavailable_is_asked_again_before_a_game_goes(repo):
    client = FakeClient(items={})                                 # answered, and unknown to Steam
    code, live = repo.run([_rec("10"), _rec("20")], client,
                          health={"10": [UNAVAILABLE, UNAVAILABLE], "20": [UNAVAILABLE, OK]})
    assert code == 0 and live == {"20"}
    assert repo.health_calls == ["10", "20", "10", "20"]
    assert len(repo.sleeps) == 1 and 0 < repo.sleeps[0] <= pu.RECHECK_AFTER
    assert [r["status_code"] for r in _removed()] == ["unavailable"]


def test_what_nobody_answered_is_never_gone(repo):
    client = FakeClient(items={"730": _item("730")}, failed={"570"})
    code, live = repo.run([_rec("730"), _rec("570"), _rec("440")], client,
                          health={"440": [NETWORK_ERROR]})
    assert (code, live) == (0, {"730", "570", "440"})
    assert repo.health_calls == ["440"]                          # 570's batch failed: not even asked


def test_no_answer_at_all_writes_nothing(repo):
    repo.run([_rec("730")], FakeClient(items={"730": _item("730")}))
    before = _bytes()
    code, live = repo.run(None, FakeClient(failed={"730"}))
    assert (code, live) == (0, {"730"}) and _bytes() == before


def test_a_blocklisted_game_is_not_asked_about(repo):
    repo.block({"570"})
    client = FakeClient(items={"730": _item("730")})
    repo.run([_rec("730"), _rec("570")], client)
    assert "570" not in client.asked[0] and repo.health_calls == []


def test_too_many_flags_stop_the_run_before_any_request(repo):
    repo.run([_rec("730"), _rec("570"), _rec("440")], FakeClient(items={a: _item(a) for a in ("730", "570", "440")}))
    before = _bytes()
    code, _ = repo.run(None, FakeClient(items={}), argv=["--max-candidates", "2"])
    assert code == 2 and repo.health_calls == [] and _bytes() == before


def test_too_many_removals_stop_the_run_before_anything_is_written(repo):
    repo.run([_rec("730"), _rec("570")], FakeClient(items={"730": _item("730"), "570": _item("570")}))
    before = _bytes()
    client = FakeClient(items={"730": _item("730", is_free=False), "570": _item("570", is_free=False)})
    code, live = repo.run(None, client, health={"730": [NOT_FREE], "570": [NOT_FREE]},
                          argv=["--max-removals", "1"])
    assert code == 2 and live == {"730", "570"} and _bytes() == before


def test_a_dry_run_writes_nothing(repo):
    repo.run([_rec("730")], FakeClient(items={"730": _item("730")}))
    before = _bytes()
    code, _ = repo.run(None, FakeClient(items={"730": _item("730", unlisted=True)}),
                       health={"730": [NOT_FREE]}, argv=["--dry-run"])
    assert code == 0 and _bytes() == before


def test_a_removal_steam_has_undone_is_named(repo, capsys):
    with open(os.path.join("scripts", "removed_games.jsonl"), "w", encoding="utf-8") as f:
        for appid, code in (("4214820", "unavailable"), ("620", "not_free"), ("99", "admin_removed")):
            f.write(json.dumps({"appid": appid, "name": f"Old {appid}", "status_code": code,
                                "removed_at": OLD}) + "\n")
    client = FakeClient(items={"730": _item("730"), "4214820": _item("4214820"),
                               "620": _item("620", is_free=False), "99": _item("99")})
    repo.run([_rec("730")], client)
    out = capsys.readouterr().out
    assert "::notice::1 removed game(s)" in out and "4214820 Old 4214820" in out
    assert "620" not in out.split("::notice::")[1] and "Old 99" not in out


def test_the_budget_leaves_the_rest_unasked(repo, monkeypatch):
    client = FakeClient(items={"730": _item("730", unlisted=True)})
    monkeypatch.setenv(budget.ENV, "0.000001")
    code, live = repo.run([_rec("730")], client, health={"730": [NOT_FREE]})
    assert (code, live) == (0, {"730"}) and repo.health_calls == []


@pytest.mark.parametrize("item, why", [
    (None, "unknown"),
    ({"visible": False, "is_free": True}, "hidden"),
    ({"visible": True, "unlisted": True}, "unlisted"),
    ({"visible": True, "is_free": True, "release": {"is_coming_soon": True}}, "coming_soon"),
    ({"visible": True}, "not_free"),
    ({"is_free": True, "type": 2}, None),                         # a free mod: type is not read
    (FREE, None),
])
def test_what_the_screen_flags(item, why):
    from core.store_items import screen_item
    assert screen_item(item) == why
