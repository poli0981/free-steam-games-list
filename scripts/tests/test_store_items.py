"""
core/store_items.py reads a game's tags and languages from Steam's JSON API
when its store page cannot be read (an 'Adult Only' game's page is a Sign In
page). These pin that the answer has the page scrape's shape, order and rules,
and that a DLC price - which arrives as a string - is read as money.

Run from the repository root:  python -m pytest scripts/tests
"""
from core.scraper import scrape_store_page
from core.store_items import language_name, paid_dlc_from_items, parse_store_item

TAG_NAMES = {12095: "Sexual Content", 6650: "Nudity", 9130: "Hentai", 597: "Casual"}


def _row(elanguage=-1, additional=-1, supported=True, audio=False, subtitles=False) -> dict:
    return {"elanguage": elanguage, "eadditionallanguage": additional,
            "supported": supported, "full_audio": audio, "subtitles": subtitles}


def test_language_ids_are_named_as_the_store_page_names_them():
    assert language_name(_row(0)) == "English"
    assert language_name(_row(27)) == "Spanish - Latin America"
    assert language_name(_row(additional=53)) == "Slovak"
    assert language_name(_row(additional=19)) == "Punjabi (Gurmukhi)"
    assert language_name(_row(29)) is None            # never seen: never stored
    assert language_name(_row(additional=999)) is None


def test_an_item_reads_like_its_store_page():
    # Isekai: Waifu Overlord (3850550): the first rows of the language table
    # and the first tags of the page the user saved, as GetItems returns them.
    item = {
        "id": 3850550, "success": 1,
        "tags": [{"tagid": 12095, "weight": 1514}, {"tagid": 6650, "weight": 1177},
                 {"tagid": 9130, "weight": 1033}, {"tagid": 7926, "weight": 767}],
        "supported_languages": [
            _row(0, audio=True, subtitles=True),
            _row(8, audio=True, subtitles=True),
            _row(2, subtitles=True),
        ],
    }
    page = (
        '<table class="game_language_options"><tr><th>x</th></tr>'
        '<tr><td>English</td><td><span>&#10004;</span></td><td><span>&#10004;</span></td>'
        '<td><span>&#10004;</span></td></tr>'
        '<tr><td>Russian</td><td><span>&#10004;</span></td><td><span>&#10004;</span></td>'
        '<td><span>&#10004;</span></td></tr>'
        '<tr><td>French</td><td><span>&#10004;</span></td><td></td>'
        '<td><span>&#10004;</span></td></tr></table>'
        '<a class="app_tag" href="#">Sexual Content</a><a class="app_tag" href="#">Nudity</a>'
        '<a class="app_tag" href="#">Hentai</a>'
    )
    parsed = parse_store_item(item, TAG_NAMES)
    scraped = scrape_store_page(page)
    assert parsed["languages"] == scraped["languages"]
    assert parsed["language_details"] == scraped["language_details"]
    assert parsed["tags"] == scraped["tags"]          # 7926 has no name here: skipped
    assert parsed["has_paid_dlc"] is None             # an item says nothing about DLC


def test_rows_follow_the_page_scrapes_rules():
    item = {"tags": [{"tagid": 597}, {"tagid": 597}], "supported_languages": [
        _row(0), _row(0), _row(1, supported=False), _row(29), _row(additional=46)]}
    parsed = parse_store_item(item, TAG_NAMES)
    assert parsed["languages"] == ["English", "Persian"]  # duplicate, unticked, unknown dropped
    assert parsed["tags"] == ["Casual"]


def test_the_tagids_list_is_read_when_weights_are_missing():
    assert parse_store_item({"tagids": [9130, "6650"]}, TAG_NAMES)["tags"] == ["Hentai", "Nudity"]


def test_a_dlc_price_is_money_even_as_a_string():
    assert paid_dlc_from_items([{"best_purchase_option": {"final_price_in_cents": "999"}}]) is True
    assert paid_dlc_from_items([{"best_purchase_option": {"final_price_in_cents": 1999}}]) is True


def test_a_dlc_on_a_full_discount_is_still_paid_dlc():
    option = {"final_price_in_cents": "0", "original_price_in_cents": "499"}
    assert paid_dlc_from_items([{"best_purchase_option": option}]) is True


def test_free_dlc_is_not_paid_and_no_dlc_item_is_unknown():
    assert paid_dlc_from_items([{"best_purchase_option": {"final_price_in_cents": "0"}}, {}]) is False
    assert paid_dlc_from_items([]) is None
