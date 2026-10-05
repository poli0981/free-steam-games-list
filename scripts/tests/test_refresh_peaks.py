"""
all_time_peak is a number this project can never fetch again if it loses one,
so these pin the rules that keep it safe: it only ever goes up, a refusal or an
error from SteamCharts changes nothing, our own samples count but a sample of
0 does not, and nothing but all_time_peak is ever written.

Run from the repository root:  python -m pytest scripts/tests
"""
import pytest
import requests

import refetch_all
import refresh_peaks as rp
from core import steamcharts
from core.data_store import make_skeleton
from core.fetcher import apply_players
from core.peaks import observed_peak, parse_count, raise_peak
from core.steamcharts import Result, SteamChartsClient, parse_all_time_peak

# The markup of a SteamCharts app page, as served on 2026-10-03 (tabs and all).
STATS = (
    '<div id="app-heading" class="content">\n'
    '\t<div class="app-stat"> \n\t\t<span class="num">76135</span>\n'
    '\t\t<br>playing <abbr class="timeago" title="2026-10-02T23:02:03Z"></abbr>\n\t</div>\n'
    '\t<div class="app-stat"> \n\t\t<span class="num">89465</span>\n\t\t<br>24-hour peak\n\t</div>\n'
    '\t<div class="app-stat"> \n\t\t<span class="num">253225</span>\n\t\t<br>all-time peak\n\t</div>\n'
    '</div>'
)


def _game(appid: str = "440", **fields) -> dict:
    base = {
        "link": f"https://store.steampowered.com/app/{appid}/",
        "name": "Team Fortress 2",
        "genre": "FPS",
        "type_game": "online",
        "notes": "Not reviewed yet",
        "current_players": "61,531",
        "peak_today": "61,531",
        "all_time_peak": "N/A",
        "last_updated": "2026-01-01T00:00:00Z",
    }
    base.update(fields)
    return base


# ──────────── Parsing the page ────────────

def test_reads_the_all_time_peak_not_the_other_stats():
    assert parse_all_time_peak(STATS) == 253225


def test_reads_a_peak_written_with_thousands_separators():
    assert parse_all_time_peak('<span class="num">1,818,368</span><br>all-time peak') == 1818368


def test_a_page_without_the_stat_has_no_peak():
    assert parse_all_time_peak("<html><title>Steam Charts</title></html>") is None
    assert parse_all_time_peak("") is None


# ──────────── What each answer means ────────────

class _Resp:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


class _Session:
    def __init__(self, answer):
        self.answer = answer
        self.headers: dict = {}
        self.urls: list[str] = []

    def get(self, url, timeout):
        self.urls.append(url)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def _fetch(answer) -> Result:
    return SteamChartsClient(session=_Session(answer), sleep=lambda s: None).fetch("440")


@pytest.mark.parametrize("answer, expected", [
    (_Resp(200, STATS), Result("ok", 253225)),
    (_Resp(500), Result("untracked")),
    (_Resp(404), Result("untracked")),
    (_Resp(403), Result("blocked")),
    (_Resp(429), Result("blocked")),
    (_Resp(200, "<html><title>Just a moment...</title><script>cf-chl</script></html>"), Result("blocked")),
    (_Resp(200, "<html><body>a page we do not recognise</body></html>"), Result("error")),
    (_Resp(502), Result("error")),
    (requests.ConnectionError("down"), Result("error")),
])
def test_each_answer_maps_to_one_outcome(answer, expected):
    assert _fetch(answer) == expected


def test_a_real_page_that_also_carries_cloudflare_script_is_still_read():
    page = STATS + '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
    assert _fetch(_Resp(200, page)) == Result("ok", 253225)


def test_requests_are_at_least_two_seconds_apart_and_name_the_project():
    now = [100.0]
    slept: list[float] = []

    def sleep(s):
        slept.append(s)
        now[0] += s

    session = _Session(_Resp(500))
    client = SteamChartsClient(session=session, sleep=sleep, clock=lambda: now[0])
    client.fetch("1")
    client.fetch("2")
    assert slept and slept[0] >= steamcharts.DELAY_MIN
    assert "free-steam-games-list" in session.headers["User-Agent"]
    assert session.urls == ["https://steamcharts.com/app/1", "https://steamcharts.com/app/2"]


# ──────────── The field only goes up ────────────

def test_parse_count_reads_only_counts():
    assert parse_count("1,818,368") == 1818368
    assert parse_count(42) == 42
    for junk in ("N/A", "Error", "", None, True, -3, "12a"):
        assert parse_count(junk) is None


@pytest.mark.parametrize("stored, count, after", [
    ("N/A", 1000, "1,000"),
    ("N/A", 0, "0"),          # SteamCharts does record games that peaked at 0
    ("1,000", 2000, "2,000"),
    ("1,000", 1000, "1,000"),
    ("1,000", 999, "1,000"),
    ("1,000", None, "1,000"),
    ("Error", 5, "5"),
])
def test_raise_peak_never_lowers(stored, count, after):
    game = {"all_time_peak": stored}
    raise_peak(game, count)
    assert game["all_time_peak"] == after


def test_our_samples_count_but_a_zero_does_not():
    assert observed_peak({"peak_today": "8,052", "current_players": "3,452"}) == 8052
    assert observed_peak({"peak_today": "0", "current_players": "0"}) is None
    assert observed_peak({"peak_today": "N/A", "current_players": "N/A"}) is None


def test_a_player_sample_raises_the_peak_but_never_lowers_it():
    game = _game(all_time_peak="N/A", peak_today="N/A")
    apply_players(game, 5000)
    assert game["all_time_peak"] == "5,000"
    apply_players(game, 20)
    assert game["all_time_peak"] == "5,000"


def test_a_sample_of_zero_does_not_invent_a_peak():
    game = _game(all_time_peak="N/A", peak_today="N/A")
    apply_players(game, 0)
    assert game["all_time_peak"] == "N/A"


# ──────────── A run ────────────

class _Client:
    def __init__(self, results: dict):
        self.results = results
        self.asked: list[str] = []

    def fetch(self, appid):
        self.asked.append(appid)
        return self.results[appid]


def test_samples_seed_every_game_without_a_request():
    games = [
        _game("1", current_players="3,452", peak_today="8,052"),
        _game("2", current_players="0", peak_today="0"),
    ]
    assert rp.raise_from_samples(games) == 1
    assert games[0]["all_time_peak"] == "8,052"
    assert games[1]["all_time_peak"] == "N/A"


def test_steamcharts_raises_and_skips_what_it_does_not_know():
    games = [_game("1"), _game("2"), _game("3", all_time_peak="300,000")]
    client = _Client({"1": Result("ok", 253225), "2": Result("untracked"), "3": Result("ok", 264860)})
    tally = rp.raise_from_steamcharts(games, client, log=lambda *a: None)
    assert [g["all_time_peak"] for g in games] == ["253,225", "N/A", "300,000"]
    assert tally == {"raised": 1, "untracked": 1, "unchanged": 1}


def test_a_refusal_stops_the_run_and_keeps_what_was_raised():
    games = [_game("1"), _game("2"), _game("3")]
    client = _Client({"1": Result("ok", 10), "2": Result("blocked"), "3": Result("ok", 30)})
    tally = rp.raise_from_steamcharts(games, client, log=lambda *a: None)
    assert client.asked == ["1", "2"]
    assert games[0]["all_time_peak"] == "10"
    assert tally["skipped"] == 2


def test_ten_errors_in_a_row_stop_the_run():
    games = [_game(str(i)) for i in range(15)]
    client = _Client({str(i): Result("error") for i in range(15)})
    tally = rp.raise_from_steamcharts(games, client, log=lambda *a: None)
    assert len(client.asked) == rp.MAX_CONSECUTIVE_ERRORS
    assert tally["error"] == rp.MAX_CONSECUTIVE_ERRORS
    assert tally["skipped"] == 15 - rp.MAX_CONSECUTIVE_ERRORS


def test_nothing_but_all_time_peak_is_written():
    game = _game("1")
    before = dict(game)
    rp.raise_from_samples([game])
    rp.raise_from_steamcharts([game], _Client({"1": Result("ok", 999_999)}), log=lambda *a: None)
    changed = {k for k in game if game[k] != before.get(k)}
    assert changed == {"all_time_peak"}


def test_every_game_is_asked_once_a_month():
    games = [_game(str(appid)) for appid in range(10, 30_010, 10)]
    days = [sum(1 for g in games if rp.due(g, rp.PEAK_CYCLE_DAYS, day)) for day in range(30)]
    assert sum(days) == len(games)
    assert min(days) > 0


# ──────────── It survives the other jobs ────────────

def test_new_records_start_without_a_peak():
    assert make_skeleton("https://store.steampowered.com/app/1/")["all_time_peak"] == "N/A"


def test_refetch_all_never_clears_it():
    # The other player fields are cleared and fetched again; this one cannot be.
    assert "all_time_peak" not in refetch_all.CLEARABLE
    assert "all_time_peak" not in refetch_all.CONDITIONAL
