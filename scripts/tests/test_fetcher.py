"""
fetch_full() builds every new game (ingest_new.py) and refills incomplete ones
(update_data.py, refetch_all.py). These pin how it treats the anti-cheat
fields: filled from the developer's disclosure on the page it already fetched,
else from appdetails' VAC category, never replaced, and never where an
override would undo it. And how it picks a genre: never a price model.

Steam is never called: the client is a fake. Run from the repository root:
python -m pytest scripts/tests
"""
import pytest

from core import fetcher
from core.data_store import make_skeleton
from core.overrides import OverrideGuard

LINK = "https://store.steampowered.com/app/2507950/"
DETAILS = {"name": "Delta Force", "type": "game", "is_free": True,
           "categories": [{"id": 1, "description": "Multi-player"}]}
VAC_DETAILS = dict(DETAILS, categories=[{"id": 1, "description": "Multi-player"},
                                        {"id": 8, "description": "Valve Anti-Cheat enabled"}])


def _page(name="Anti-Cheat Expert (ACE)", heading="Uses Kernel Level Anti-Cheat") -> str:
    section = (f'<div class="anticheat_section DRM_notice" ><div>{heading}</div>'
               f'<div class="anticheat_name">{name}<span class="anticheat_uninstalls"></span></div></div>')
    return ('<table class="game_language_options"><tr><th>x</th></tr><tr><td>English</td>'
            '<td><span>&#10004;</span></td><td></td><td></td></tr></table>'
            '<a class="app_tag" href="#">FPS</a>' + section)


class FakeClient:
    """`reviews` is appreviews' query_summary (None: it redirected), and
    `review_items` GetItems' answer to include_reviews (None: the batch failed)."""

    def __init__(self, page=None, status=None, items=None, reviews=None, review_items=None):
        self.page = page
        self.status = status or ("ok" if page is not None else "network_error")
        self.items = items
        self.reviews, self.review_items = reviews, review_items
        self.asked_items = 0

    def fetch_app_details(self, appid):
        return dict(DETAILS)

    def fetch_reviews(self, appid):
        return self.reviews

    def fetch_items(self, appids, data_request, give_up_after=10):
        assert data_request == {"include_reviews": True}
        self.asked_items += 1
        if self.review_items is None:
            return {}, set(appids)
        return {a: self.review_items[a] for a in appids if a in self.review_items}, set()

    def fetch_store_page_full(self, appid):
        return (self.status, self.page if self.status == "ok" else None)

    def fetch_store_items(self, appids):
        return self.items

    def fetch_tag_names(self):
        return {}


def _fetch(game=None, client=None, details=DETAILS, guard=None) -> dict:
    game = game or make_skeleton(LINK)
    return fetcher.fetch_full(game, client=client or FakeClient(page=_page()), fetch_players=False,
                              prefetched_details=dict(details), guard=guard)


def test_fetch_full_fills_from_the_page():
    game = _fetch()
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == \
        ("ACE", "Anti-Cheat Expert (ACE) [Kernel]", True)


def test_a_gated_game_is_filled_from_steam_s_json():
    items = {"2507950": {"id": 2507950, "success": 1, "extra_details": {
        "anticheat": {"kernel_mode": True, "name": "Easy Anti-Cheat"}}}}
    game = _fetch(client=FakeClient(status="age_gate", items=items))
    assert (game["anti_cheat"], game["is_kernel_ac"]) == ("EAC", True)


def test_vac_comes_from_the_category_only_when_steam_declares_nothing():
    game = _fetch(client=FakeClient(page=_page().split('<div class="anticheat_section')[0]), details=VAC_DETAILS)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == \
        ("VAC", "VAC (Valve Anti-Cheat) [Non-Kernel]", False)
    # A disclosure wins over the category.
    assert _fetch(details=VAC_DETAILS)["anti_cheat"] == "ACE"


def test_fetch_full_never_replaces_another_product():
    game = make_skeleton(LINK)
    game.update(anti_cheat="EAC", anti_cheat_note="EAC", is_kernel_ac=False)
    _fetch(game)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == ("EAC", "EAC", False)


def _reviews_item(count, pct=0, label=""):
    return {"2507950": {"id": 2507950, "success": 1, "reviews": {"summary_filtered": {
        "review_count": count, "percent_positive": pct, "review_score_label": label}}}}


def test_reviews_come_from_appreviews_when_it_answers():
    client = FakeClient(page=_page(), reviews={"total_reviews": 3, "total_positive": 2,
                                                "review_score_desc": "3 user reviews"})
    assert _fetch(client=client)["reviews"] == "66% (3 user reviews)"
    assert client.asked_items == 0


def test_reviews_come_from_the_store_api_when_appreviews_does_not_answer():
    # Since 2026-10-23 appreviews answers with a redirect to the store front.
    client = FakeClient(page=_page(), review_items=_reviews_item(52341, 80, "Very Positive"))
    assert _fetch(client=client)["reviews"] == "80% (Very Positive)"
    assert _fetch(client=FakeClient(page=_page(), review_items=_reviews_item(0)))["reviews"] == "No reviews"


def test_reviews_stay_unknown_when_neither_answers():
    assert _fetch(client=FakeClient(page=_page()))["reviews"] == "N/A"


def test_apply_details_writes_no_anti_cheat():
    game = make_skeleton(LINK)
    fetcher.apply_details(game, VAC_DETAILS)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == ("-", "", None)


@pytest.mark.parametrize("genres, genre", [
    (["Action", "Free To Play"], "Action"),
    # appdetails capitalises the T; the skip list used to miss it.
    (["Casual", "Free To Play", "Indie"], "Casual"),
    (["Free To Play", "Massively Multiplayer"], "Massively Multiplayer"),
    (["Free To Play", "Early Access"], "Uncategorized"),
    (["Free To Play"], "Uncategorized"),
    (["Indie", "Simulation"], "Simulation"),
    ([], "Uncategorized"),
    ([" RPG ", None, ""], "RPG"),
])
def test_pick_genre_never_picks_a_price_model(genres, genre):
    assert fetcher.pick_genre(genres) == genre


def test_apply_details_reads_genres_case_insensitively():
    game = make_skeleton(LINK)
    game["genre"] = ""
    fetcher.apply_details(game, {"genres": [{"id": "37", "description": "Free To Play"},
                                            {"id": "4", "description": "Casual"}]})
    assert game["genre"] == "Casual"


@pytest.mark.parametrize("genre, stray", [
    ("Free To Play", True), ("free to play", True), (" Early Access ", True),
    ("Casual", False), ("", False), (None, False), (["Free To Play"], False),
])
def test_a_stray_genre_is_one_no_person_chose(genre, stray):
    assert fetcher.is_stray_genre(genre) is stray


def test_the_guard_reaches_fetch_full():
    # A restored game keeps its override, here "nobody has verified the kernel
    # flag": filling it would be undone by save_main() on every run.
    guard = OverrideGuard({"2507950": {"fields": {"is_kernel_ac": {"value": None}}}})
    game = _fetch(guard=guard)
    assert game["anti_cheat"] == "ACE"
    assert game["is_kernel_ac"] is None
