"""
fetch_full() builds every new game (ingest_new.py) and refills incomplete ones
(update_data.py, refetch_all.py). These pin how it treats the anti-cheat
fields: filled from the developer's disclosure on the page it already fetched,
else from appdetails' VAC category, never replaced, and never where an
override would undo it.

Steam is never called: the client is a fake. Run from the repository root:
python -m pytest scripts/tests
"""
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
    def __init__(self, page=None, status=None, items=None):
        self.page = page
        self.status = status or ("ok" if page is not None else "network_error")
        self.items = items

    def fetch_app_details(self, appid):
        return dict(DETAILS)

    def fetch_reviews(self, appid):
        return None

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
        ("Anti-Cheat Expert (ACE)", "Anti-Cheat Expert (ACE) [Kernel]", True)


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
    assert _fetch(details=VAC_DETAILS)["anti_cheat"] == "Anti-Cheat Expert (ACE)"


def test_fetch_full_never_replaces_another_product():
    game = make_skeleton(LINK)
    game.update(anti_cheat="EAC", anti_cheat_note="EAC", is_kernel_ac=False)
    _fetch(game)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == ("EAC", "EAC", False)


def test_apply_details_writes_no_anti_cheat():
    game = make_skeleton(LINK)
    fetcher.apply_details(game, VAC_DETAILS)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == ("-", "", None)


def test_the_guard_reaches_fetch_full():
    # A restored game keeps its override, here "nobody has verified the kernel
    # flag": filling it would be undone by save_main() on every run.
    guard = OverrideGuard({"2507950": {"fields": {"is_kernel_ac": {"value": None}}}})
    game = _fetch(guard=guard)
    assert game["anti_cheat"] == "Anti-Cheat Expert (ACE)"
    assert game["is_kernel_ac"] is None
