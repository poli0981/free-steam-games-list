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
from core.normalize import decode_entities
from core.rotation import slice_of
from core.scraper import scrape_store_page


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
    """Canned answers. `status` is what the store page request ended on
    (steam_client.store_page_status); `items` is GetItems' answer, by appid."""

    def __init__(self, details=None, page=None, status=None, items=None, tag_names=None):
        self.details, self.page = details, page
        self.status = status or ("ok" if page is not None else "network_error")
        self.items = items
        self.tag_names = tag_names or {}
        self.calls: list[str] = []

    def fetch_app_details(self, appid):
        self.calls.append(f"details:{appid}")
        return self.details

    def fetch_store_page_full(self, appid):
        self.calls.append(f"page:{appid}")
        return (self.status, self.page if self.status == "ok" else None)

    def fetch_store_items(self, appids):
        self.calls.append("items:" + ",".join(str(a) for a in appids))
        if self.items is None:
            return None
        return {str(a): self.items[str(a)] for a in appids if str(a) in self.items}

    def fetch_tag_names(self):
        return self.tag_names


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
            sizes[slice_of(a, cycle)] += 1
        mean = len(appids) / cycle
        assert min(sizes) > 0.7 * mean and max(sizes) < 1.3 * mean, (cycle, sizes)


def test_consecutive_days_walk_through_every_slice():
    start = rsd.day_number()
    seen = {(start + d) % rsd.DETAILS_CYCLE_DAYS for d in range(rsd.DETAILS_CYCLE_DAYS)}
    assert seen == set(range(rsd.DETAILS_CYCLE_DAYS))


# ──────────── Store page ────────────

def test_a_store_page_replaces_tags_languages_and_the_dlc_flag():
    game = _game()
    changed = rsd.apply_store_page(game, scrape_store_page(_page(dlc=False)))
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
    assert rsd.apply_store_page(game, scrape_store_page("<html>Please enter your birth date</html>")) == []
    assert game == before


def test_a_partial_page_keeps_what_it_does_not_show():
    game = _game()
    rsd.apply_store_page(game, scrape_store_page(_page(languages=(), tags=("Action",))))
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


# ──────────── Gated store pages ────────────
# An 'Adult Only' game's page is a Sign In page (no cookie opens it), so the
# same facts come from Steam's JSON API. These are 3850550's own rows from
# GetItems on 2026-10-10, in the order of the language table on its page.

ADULT = "3850550"
TAG_NAMES = {12095: "Sexual Content", 6650: "Nudity", 9130: "Hentai", 597: "Casual"}
ITEM = {
    "id": 3850550, "appid": 3850550, "success": 1, "visible": True,
    "tags": [{"tagid": 12095, "weight": 1514}, {"tagid": 6650, "weight": 1177},
             {"tagid": 9130, "weight": 1033}],
    "supported_languages": [
        {"elanguage": 0, "eadditionallanguage": -1, "supported": True, "full_audio": True, "subtitles": True},
        {"elanguage": 8, "eadditionallanguage": -1, "supported": True, "full_audio": True, "subtitles": True},
        {"elanguage": 2, "eadditionallanguage": -1, "supported": True, "full_audio": False, "subtitles": True},
    ],
}
PAID_DLC = {"id": 1918000, "success": 1, "best_purchase_option": {"final_price_in_cents": "999"}}


def _gated(**fields) -> dict:
    base = dict(tags=[], languages=[], language_details=[], has_paid_dlc=False)
    base.update(fields)
    return _game(ADULT, **base)


def test_an_age_gated_game_is_read_from_the_json_api():
    game = _gated()
    client = FakeClient(status="age_gate", details={"dlc": [1918000]}, tag_names=TAG_NAMES,
                        items={ADULT: ITEM, "1918000": PAID_DLC})
    changed = rsd.refresh_game(game, client, page=True, details=False)
    assert game["tags"] == ["Sexual Content", "Nudity", "Hentai"]
    assert game["languages"] == ["English", "Russian", "French"]
    assert game["language_details"][2] == {
        "name": "French", "interface": True, "audio": False, "subtitles": True}
    assert game["has_paid_dlc"] is True  # from the DLC's price, not from the gate
    assert set(changed) == {"tags", "languages", "language_details", "has_paid_dlc"}


def test_the_dlc_check_reuses_the_appdetails_already_fetched():
    client = FakeClient(status="age_gate", details={"name": "Counter-Strike 2", "dlc": [1918000]},
                        tag_names=TAG_NAMES, items={ADULT: ITEM, "1918000": PAID_DLC})
    rsd.refresh_game(_gated(), client, page=True, details=True)
    assert client.calls.count(f"details:{ADULT}") == 1


def test_a_game_with_no_dlc_has_no_paid_dlc():
    game = _gated(has_paid_dlc=True)
    client = FakeClient(status="age_gate", details={"name": "x"}, tag_names=TAG_NAMES,
                        items={ADULT: ITEM})
    rsd.refresh_game(game, client, page=True, details=False)
    assert game["has_paid_dlc"] is False


def test_a_dlc_flag_that_cannot_be_read_is_left_alone():
    # appdetails failed: unknown is not "no paid DLC".
    game = _gated(has_paid_dlc=True)
    client = FakeClient(status="age_gate", details=None, tag_names=TAG_NAMES, items={ADULT: ITEM})
    rsd.refresh_game(game, client, page=True, details=False)
    assert game["tags"] and game["has_paid_dlc"] is True


def test_a_gate_with_the_api_down_changes_nothing():
    game = _game(ADULT)
    before = dict(game)
    assert rsd.refresh_game(game, FakeClient(status="age_gate", items=None),
                            page=True, details=False) == []
    assert game == before


def test_a_failed_page_request_does_not_ask_the_api():
    client = FakeClient(page=None)
    rsd.refresh_game(_game(), client, page=True, details=False)
    assert client.calls == ["page:730"]


def test_a_page_without_a_language_table_gets_only_its_languages_from_the_api():
    game = _game(languages=[], language_details=[], has_paid_dlc=False)
    client = FakeClient(page=_page(languages=(), tags=("FPS",), dlc=True),
                        items={"730": dict(ITEM, id=730)}, tag_names=TAG_NAMES)
    rsd.refresh_game(game, client, page=True, details=False)
    assert game["tags"] == ["FPS"]                     # the page's own
    assert game["languages"] == ["English", "Russian", "French"]
    assert game["has_paid_dlc"] is True                # the page's DLC section


def test_tag_and_language_names_are_unescaped_and_tokens_named():
    page = ('<table class="game_language_options"><tr><th>x</th></tr>'
            '<tr><td>#lang_slovakian</td><td><span>&#10004;</span></td><td></td><td></td></tr>'
            '<tr><td>#lang_klingon</td><td><span>&#10004;</span></td><td></td><td></td></tr>'
            '</table><a class="app_tag" href="#">Point &amp; Click</a>')
    scraped = scrape_store_page(page)
    assert scraped["languages"] == ["Slovak"]
    assert scraped["tags"] == ["Point & Click"]


# ──────────── Games with empty store fields ────────────

def test_a_game_with_empty_store_fields_is_refreshed_every_day_and_first():
    empty = _game("4156010", tags=[], languages=[], language_details=[])
    games = [_game(str(1000 + 10 * i)) for i in range(50)] + [empty]
    for day in range(rsd.PAGE_CYCLE_DAYS):
        plan = rsd.build_plan(games, day)
        assert plan[0][0] is empty and plan[0][1] is True
        assert sum(1 for g, _, _ in plan if g is empty) == 1


def test_repairs_are_capped_and_the_rest_keep_their_slice(monkeypatch):
    monkeypatch.setattr(rsd, "MISSING_DAILY_CAP", 3)
    games = [_game(str(10 * i), tags=[]) for i in range(1, 21)]
    plan = rsd.build_plan(games, day=5, want_details=False)
    repaired = {id(g) for g, _, _ in plan[:3]}
    assert all(p for _, p, _ in plan[:3])
    assert {id(g) for g, _, _ in plan[3:]} == {
        id(g) for g in games if id(g) not in repaired and rsd.due(g, rsd.PAGE_CYCLE_DAYS, 5)}


def test_missing_only_takes_just_the_repairs():
    games = [_game("730"), _game("4156010", languages=[])]
    plan = rsd.build_plan(games, day=0, missing_only=True)
    assert [(g["link"], p, d) for g, p, d in plan] == [(games[1]["link"], True, False)]


def test_a_details_only_run_repairs_no_page():
    plan = rsd.build_plan([_game("4156010", tags=[])], day=0, want_page=False)
    assert not any(p for _, p, _ in plan)


# ──────────── Compared as stored ────────────

def test_a_release_date_in_another_shape_is_not_a_change():
    game = _game(release_date="Aug 21, 2012")
    assert "release_date" not in rsd.apply_app_details(game, {"release_date": {"date": "21 Aug, 2012"}})
    assert game["release_date"] == "Aug 21, 2012"


def test_a_release_date_is_stored_in_the_one_shape():
    game = _game(release_date="Coming soon")
    rsd.apply_app_details(game, {"release_date": {"date": "28 апр. 2025 г."}})
    assert game["release_date"] == "Apr 28, 2025"


def test_names_are_compared_cleaned():
    game = _game(developer=["Wilma Wiiand"], publisher=["Gameforge 4D GmbH"])
    changed = rsd.apply_app_details(game, {
        "developers": ["Wilma Wiiand​​", " "],
        "publishers": ["Gameforge 4D GmbH‬"],
    })
    assert "developer" not in changed and "publisher" not in changed


def test_an_escaped_blurb_is_decoded_before_it_is_cut():
    game = _game(description="")
    rsd.apply_app_details(game, {"short_description": "a tiny art &quot;game&quot; " + "word " * 60})
    assert game["description"].startswith('a tiny art "game" word')
    assert len(game["description"]) <= DESCRIPTION_MAX


def test_a_blurb_that_now_fits_further_is_written_but_is_not_news():
    blurb = 'a tiny art "game" ' + "word " * 60
    escaped = blurb.replace('"', "&quot;")
    # What the old pipeline left: cut while still escaped, then decoded on save.
    game = _game(description=decode_entities(rsd.truncate_description(escaped)))
    assert "description" not in rsd.apply_app_details(game, {"short_description": escaped})
    assert game["description"] == rsd.truncate_description(blurb)


def test_a_rewritten_blurb_is_a_change():
    game = _game(description="Old words, cut short…")
    assert "description" in rsd.apply_app_details(game, {"short_description": "New words entirely."})
