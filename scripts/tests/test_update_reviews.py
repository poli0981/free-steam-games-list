"""
update_reviews.py reads every game's review summary from GetItems in a
hundred-odd requests. These pin what makes that safe to run daily: Steam's
floored percentage is written in the stored shape, a count of 0 is never
trusted on its own, an unanswered game keeps its value, last_updated moves
only on a change or on the heartbeat that keeps the site's "stale" badge
quiet, and a second run writes the same bytes.

Steam is never called: the client is a fake. Run from the repository root:
python -m pytest scripts/tests
"""
import os
import zlib
from datetime import datetime, timedelta, timezone

import pytest

import update_reviews as ur
from core import budget, data_store
from core.fetcher import reviews_from_summary

STAMP = "2026-10-23T06:30:00Z"
OLD = "2026-01-01T00:00:00Z"
NOW = datetime(2026, 10, 23, 6, 30, tzinfo=timezone.utc)


def _recent(days: int = 1) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rec(appid: str, reviews: str, last_updated: str = OLD) -> dict:
    return {"link": f"https://store.steampowered.com/app/{appid}/", "name": f"Game {appid}",
            "reviews": reviews, "type_game": "online", "notes": "Not reviewed yet",
            "last_updated": last_updated}


def _item(appid: str, count=None, pct=None, label=None) -> dict:
    item = {"id": int(appid), "success": 1}
    if count is not None:
        summary = {"review_count": count, "review_score_label": label}
        if pct is not None:
            summary["percent_positive"] = pct
        item["reviews"] = {"summary_filtered": summary}
    return item


class FakeClient:
    """GetItems items by appid (absent: Steam does not know it), the appids
    whose batch failed, and appreviews' query_summary by appid (None: failed)."""

    def __init__(self, items=None, failed=(), appreviews=None):
        self.items, self.failed = items or {}, set(failed)
        self.appreviews = appreviews or {}
        self.asked: list[str] = []

    def fetch_items(self, appids, data_request, give_up_after=10):
        assert data_request == {"include_reviews": True}
        return ({a: self.items[a] for a in appids if a in self.items and a not in self.failed},
                {a for a in appids if a in self.failed})

    def fetch_reviews(self, appid):
        self.asked.append(appid)
        return self.appreviews.get(appid)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    monkeypatch.setattr(ur, "now_iso", lambda: STAMP)
    monkeypatch.delenv(budget.ENV, raising=False)
    monkeypatch.setattr("core.fetcher.time.sleep", lambda s: None)

    def run(records=None, client=None, argv=()):
        if records is not None:
            data_store.save_main(records, apply_human_overrides=False)
        monkeypatch.setattr(ur, "get_client", lambda: client)
        ur.main(list(argv))
        return {data_store.extract_appid(g["link"]): g for g in data_store.load_main()}
    return run


def _bytes() -> dict:
    return {n: open(os.path.join("data", n), "rb").read()
            for n in sorted(os.listdir("data")) if n.endswith((".jsonl", ".json"))}


# ──────────── The stored shape ────────────

@pytest.mark.parametrize("pos, total, expected", [
    (29, 100, "29% (Mixed)"),          # floor(29/100*100) in floating point is 28
    (2, 3, "66% (Mixed)"),
    (999, 1000, "99% (Mixed)"),
    (0, 0, "No reviews"),
])
def test_appreviews_is_floored_in_integers(pos, total, expected):
    summary = {"total_positive": pos, "total_reviews": total, "review_score_desc": "Mixed"}
    assert reviews_from_summary(summary) == expected


@pytest.mark.parametrize("stored, item, expected", [
    ("86% (Very Positive)", _item("1", 9943066, 85, "Very Positive"), (ur.SET, "85% (Very Positive)")),
    ("N/A", _item("1", 3, 100, "3 user reviews"), (ur.SET, "100% (3 user reviews)")),
    ("N/A", _item("1", 12, 50, ""), (ur.SET, "50%")),
    ("No reviews", _item("1", 0, 0, "No user reviews"), (ur.KEEP, None)),
    ("93% (Very Positive)", _item("1", 0, 0, "No user reviews"), (ur.ASK, None)),
    ("N/A", _item("1", 0, 0, "No user reviews"), (ur.ASK, None)),
    ("", _item("1", 0), (ur.ASK, None)),
    ("50% (Mixed)", None, (ur.UNKNOWN, None)),
    ("50% (Mixed)", _item("1"), (ur.UNKNOWN, None)),                  # no summary
    ("50% (Mixed)", _item("1", 40, None, "Mixed"), (ur.UNKNOWN, None)),  # count without a share
    ("50% (Mixed)", _item("1", 40, 101, "Mixed"), (ur.UNKNOWN, None)),
    ("50% (Mixed)", {"reviews": {"summary_filtered": {"percent_positive": 50}}}, (ur.UNKNOWN, None)),
])
def test_what_an_item_says_to_do(stored, item, expected):
    assert ur.decide(stored, item) == expected


def test_the_heartbeat_spreads_over_a_week_and_reads_a_bad_stamp_as_due():
    game = _rec("730", "85% (Very Positive)")
    days = ur.HEARTBEAT_DAYS + zlib.crc32(b"730") % ur.HEARTBEAT_JITTER_DAYS
    assert 14 <= days <= 20
    game["last_updated"] = (NOW - timedelta(days=days - 1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert not ur.heartbeat_due(game, NOW)
    game["last_updated"] = (NOW - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert ur.heartbeat_due(game, NOW)
    game["last_updated"] = ""
    assert ur.heartbeat_due(game, NOW)


# ──────────── A run ────────────

def test_a_changed_summary_is_written_and_stamped(repo):
    client = FakeClient(items={"730": _item("730", 100, 85, "Very Positive")})
    out = repo([_rec("730", "86% (Very Positive)", _recent())], client)
    assert out["730"]["reviews"] == "85% (Very Positive)"
    assert out["730"]["last_updated"] == STAMP
    assert client.asked == []


def test_an_unchanged_game_keeps_its_stamp_until_its_heartbeat(repo):
    recent, old = _recent(), _recent(days=40)
    client = FakeClient(items={"730": _item("730", 100, 85, "Very Positive"),
                               "570": _item("570", 100, 80, "Very Positive")})
    out = repo([_rec("730", "85% (Very Positive)", recent), _rec("570", "80% (Very Positive)", old)], client)
    assert out["730"]["last_updated"] == recent
    assert out["570"]["last_updated"] == STAMP          # read, and due its heartbeat


def test_a_second_run_writes_the_same_bytes(repo):
    client = FakeClient(items={"730": _item("730", 100, 85, "Very Positive"),
                               "570": _item("570", 0, 0, "No user reviews")},
                        appreviews={"570": {"total_reviews": 4, "total_positive": 3,
                                            "review_score_desc": "4 user reviews"}})
    repo([_rec("730", "86% (Very Positive)"), _rec("570", "N/A")], client)
    first = _bytes()
    out = repo(None, client)
    assert _bytes() == first
    assert out["570"]["reviews"] == "75% (4 user reviews)"


def test_a_zero_is_checked_on_appreviews_before_a_percentage_goes(repo):
    zero = _item("845070", 0, 0, "No user reviews")
    failing = FakeClient(items={"845070": zero}, appreviews={"845070": None})
    out = repo([_rec("845070", "93% (Very Positive)")], failing)
    assert out["845070"]["reviews"] == "93% (Very Positive)"
    assert out["845070"]["last_updated"] == OLD         # not read: no heartbeat either
    assert failing.asked == ["845070"]

    answered = FakeClient(items={"845070": zero}, appreviews={"845070": {
        "total_reviews": 5843, "total_positive": 5318, "review_score_desc": "Very Positive"}})
    assert repo(None, answered)["845070"]["reviews"] == "91% (Very Positive)"

    gone = FakeClient(items={"845070": zero}, appreviews={"845070": {"total_reviews": 0}})
    assert repo(None, gone)["845070"]["reviews"] == "No reviews"


def test_no_reviews_stays_without_asking(repo):
    client = FakeClient(items={"4263530": _item("4263530", 0, 0, "No user reviews")})
    out = repo([_rec("4263530", "No reviews", _recent())], client)
    assert out["4263530"]["reviews"] == "No reviews" and client.asked == []


def test_an_unanswered_game_keeps_everything(repo):
    client = FakeClient(items={"730": _item("730", 100, 85, "Very Positive"),
                               "570": _item("570", 100, 70, "Mostly Positive")}, failed={"570"})
    out = repo([_rec("730", "86% (Very Positive)"), _rec("570", "80% (Very Positive)")], client)
    assert out["570"]["reviews"] == "80% (Very Positive)" and out["570"]["last_updated"] == OLD
    assert out["730"]["reviews"] == "85% (Very Positive)"


def test_no_answer_at_all_writes_nothing(repo):
    repo([_rec("730", "86% (Very Positive)"), _rec("570", "80% (Very Positive)")], FakeClient())
    before = _bytes()
    repo(None, FakeClient(failed={"730", "570"}))
    assert _bytes() == before


def test_appreviews_is_capped_and_stops_at_the_deadline(repo, monkeypatch):
    zero = {a: _item(a, 0, 0, "No user reviews") for a in ("10", "20", "30")}
    summary = {"total_reviews": 1, "total_positive": 1, "review_score_desc": "1 user reviews"}
    client = FakeClient(items=zero, appreviews={a: summary for a in zero})
    monkeypatch.setattr(ur, "ASK_CAP", 2)
    out = repo([_rec(a, "N/A") for a in zero], client)
    assert len(client.asked) == 2
    assert sum(g["reviews"] == "100% (1 user reviews)" for g in out.values()) == 2

    client = FakeClient(items=zero, appreviews={a: summary for a in zero})
    monkeypatch.setenv(budget.ENV, "0.000001")
    repo(None, client)
    assert client.asked == []


def test_a_dry_run_writes_nothing(repo):
    repo([_rec("730", "86% (Very Positive)")], FakeClient())
    before = _bytes()
    repo(None, FakeClient(items={"730": _item("730", 100, 85, "Very Positive")}), argv=["--dry-run"])
    assert _bytes() == before
