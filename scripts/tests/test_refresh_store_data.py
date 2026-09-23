"""
refresh_store_data.py replaces fields that used to be written only when empty,
on a rotation through the catalogue. These pin what makes that safe: every game
is visited once per cycle, a failed or partial fetch never blanks a stored
value, human judgement is never touched, and an unchanged game stays unchanged.

Run from the repository root:  python -m pytest scripts/tests
"""
import pytest

import refresh_store_data as rsd
from core.constants import MANUAL_FIELDS, DESCRIPTION_MAX


def _game(appid: str = "730", **fields) -> dict:
    base = {
        "link": f"https://store.steampowered.com/app/{appid}/",
        "name": "Counter-Strike 2",
        "genre": "FPS",
        "type_game": "online",
        "anti_cheat": "VAC",
        "notes": "Not reviewed yet",
        "tags": ["FPS", "Shooter"],
        "languages": ["English"],
        "language_details": [{"name": "English", "interface": True, "audio": True, "subtitles": True}],
        "has_paid_dlc": True,
        "last_updated": "2026-01-01T00:00:00Z",
    }
    base.update(fields)
    return base


def _page(languages=("English", "Vietnamese"), tags=("FPS", "Shooter", "Competitive"), dlc=False) -> str:
    rows = "".join(
        f"<tr><td>{lang}</td><td><span>&#10004;</span></td><td><span>&#10004;</span></td>"
        f"<td><span>&#10004;</span></td></tr>"
        for lang in languages
    )
    table = f'<table class="game_language_options"><tr><th>x</th></tr>{rows}</table>' if languages else ""
    tag_links = "".join(f'<a class="app_tag" href="#">{t}</a>' for t in tags)
    dlc_html = (
        '<div id="gameAreaDLCSection"><a class="game_area_dlc_row" data-price-final="499">DLC</a></div>'
        if dlc else ""
    )
    return f"<html>{table}{tag_links}{dlc_html}</html>"


class FakeClient:
    def __init__(self, details=None, page=None):
        self.details, self.page = details, page
        self.calls: list[str] = []

    def fetch_app_details(self, appid):
        self.calls.append(f"details:{appid}")
        return self.details

    def fetch_store_page(self, appid):
        self.calls.append(f"page:{appid}")
        return self.page


# ──────────── Rotation ────────────

@pytest.mark.parametrize("cycle", [rsd.PAGE_CYCLE_DAYS, rsd.DETAILS_CYCLE_DAYS])
def test_every_game_is_due_exactly_once_per_cycle(cycle):
    games = [_game(str(1000 + 10 * i)) for i in range(500)]
    for g in games:
        days = [d for d in range(cycle) if rsd.due(g, cycle, d)]
        assert len(days) == 1, g["link"]


def test_slices_are_even_although_appids_are_multiples_of_ten():
    # Real Steam appids: nearly all end in 0. appid % 30 would use 3 of the 30
    # monthly slices; crc32 must spread them across all of them.
    appids = [str(10 * i) for i in range(1, 4401)]
    for cycle in (rsd.PAGE_CYCLE_DAYS, rsd.DETAILS_CYCLE_DAYS):
        sizes = [0] * cycle
        for a in appids:
            sizes[rsd.slice_of(a, cycle)] += 1
        mean = len(appids) / cycle
        assert min(sizes) > 0.7 * mean and max(sizes) < 1.3 * mean, (cycle, sizes)


def test_consecutive_days_walk_through_every_slice():
    start = rsd.day_number()
    seen = {(start + d) % rsd.DETAILS_CYCLE_DAYS for d in range(rsd.DETAILS_CYCLE_DAYS)}
    assert seen == set(range(rsd.DETAILS_CYCLE_DAYS))


# ──────────── Store page ────────────

def test_a_store_page_replaces_tags_languages_and_the_dlc_flag():
    game = _game()
    changed = rsd.apply_store_page(game, rsd.scrape_store_page(_page(dlc=False)))
    assert game["tags"] == ["FPS", "Shooter", "Competitive"]
    assert game["languages"] == ["English", "Vietnamese"]
    assert [d["name"] for d in game["language_details"]] == ["English", "Vietnamese"]
    assert game["has_paid_dlc"] is False
    assert set(changed) == {"tags", "languages", "language_details", "has_paid_dlc"}


def test_a_page_that_is_not_a_store_page_changes_nothing():
    # An age gate or a redirect to the front page: no language table, no tags,
    # no DLC section. Read naively it would wipe tags and flip has_paid_dlc.
    game = _game()
    before = dict(game)
    assert rsd.apply_store_page(game, rsd.scrape_store_page("<html>Please enter your birth date</html>")) == []
    assert game == before


def test_a_partial_page_keeps_what_it_does_not_show():
    game = _game()
    rsd.apply_store_page(game, rsd.scrape_store_page(_page(languages=(), tags=("Action",))))
    assert game["tags"] == ["Action"]
    assert game["languages"] == ["English"]  # no language table on this page: kept


# ──────────── appdetails ────────────

def test_details_replace_the_non_manual_fields():
    game = _game(developer=["Old Studio"], platforms=["Windows"], metacritic="N/A",
                 header_image="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg?t=1")
    data = {
        "name": "Counter-Strike 2",
        "header_image": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg?t=2",
        "developers": ["Valve"],
        "publishers": ["Valve"],
        "release_date": {"date": "21 Aug, 2012"},
        "platforms": {"windows": True, "mac": False, "linux": True},
        "metacritic": {"score": 83},
        "categories": [{"description": "Valve Anti-Cheat enabled"}],
        "genres": [{"description": "Action"}],
    }
    changed = rsd.apply_app_details(game, data)
    assert game["developer"] == ["Valve"]
    assert game["platforms"] == ["Windows", "Linux"]
    assert game["metacritic"] == "83"
    assert game["header_image"].endswith("?t=2")
    assert game["drm_notes"] == "None detected"
    assert "name" not in changed  # unchanged name is not a change
    # Human judgement is out of reach, even when Steam offers a value for it.
    assert game["genre"] == "FPS" and game["anti_cheat"] == "VAC" and game["type_game"] == "online"


def test_missing_or_empty_details_never_blank_a_stored_value():
    game = _game(developer=["Valve"], metacritic="83", release_date="21 Aug, 2012", platforms=["Windows"])
    rsd.apply_app_details(game, {"developers": [], "platforms": {}, "release_date": {"date": ""}})
    assert game["developer"] == ["Valve"]
    assert game["metacritic"] == "83"
    assert game["release_date"] == "21 Aug, 2012"
    assert game["platforms"] == ["Windows"]


def test_description_is_compared_as_stored():
    blurb = "word " * 80  # far longer than DESCRIPTION_MAX
    game = _game(description=rsd.truncate_description(blurb))
    assert len(game["description"]) <= DESCRIPTION_MAX
    assert "description" not in rsd.apply_app_details(game, {"short_description": blurb})


def test_the_refreshed_fields_never_include_human_judgement():
    assert not (set(rsd.PAGE_FIELDS) | set(rsd.DETAILS_FIELDS)) & MANUAL_FIELDS
    assert "notes" not in rsd.PAGE_FIELDS + rsd.DETAILS_FIELDS


# ──────────── One game, end to end ────────────

def test_an_unchanged_game_keeps_its_last_updated(monkeypatch):
    monkeypatch.setattr(rsd, "now_iso", lambda: "2026-09-23T00:00:00Z")
    game = _game()
    page = _page(languages=("English",), tags=("FPS", "Shooter"), dlc=True)
    assert rsd.refresh_game(game, FakeClient(page=page), page=True, details=False) == []
    assert game["last_updated"] == "2026-01-01T00:00:00Z"


def test_a_changed_game_gets_a_new_last_updated(monkeypatch):
    monkeypatch.setattr(rsd, "now_iso", lambda: "2026-09-23T00:00:00Z")
    game = _game()
    client = FakeClient(page=_page())
    assert rsd.refresh_game(game, client, page=True, details=False)
    assert game["last_updated"] == "2026-09-23T00:00:00Z"
    assert client.calls == ["page:730"]  # the details group was not due


def test_a_failed_fetch_changes_nothing(monkeypatch):
    monkeypatch.setattr(rsd, "now_iso", lambda: "2026-09-23T00:00:00Z")
    game = _game()
    before = dict(game)
    assert rsd.refresh_game(game, FakeClient(details=None, page=None), page=True, details=True) == []
    assert game == before
