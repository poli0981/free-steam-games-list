"""
A game's store-page facts from Steam's JSON API, for the pages we cannot read.

An 'Adult Only Sexual Content' game's store page cannot be read anonymously:
/app/<id>/ redirects to /agecheck/app/<id>/ and on to a Sign In page, and no
age cookie gets past it (measured 2026-10-10). Valve's own store front loads
the same facts from IStoreBrowseService/GetItems, which needs neither a login
nor a key and answers for those games like any other, in the page's own order:

  tags                  tag ids, most-voted first: the page's app_tag list
  supported_languages   one row per language, in the order of the page's
                        game_language_options table, with its three columns:
                        supported (Interface), full_audio, subtitles

Checked against stored HTML scrapes of 40 random games: 37 identical tag lists
(the other three had drifted since they were scraped), 40 identical language
lists, no unknown tag id. Tag ids are named by IStoreService/GetTagList.

The daily sweeps read the same items for the whole catalogue, a hundred-odd
requests where a request per game took hours: review_summary() for
update_reviews.py, screen_item() for purge_unhealthy.py.

Everything here is pure; steam_client.py makes the requests.
"""
from typing import Iterable, Optional

from .anticheat import from_store_item

# Steam's ELanguage ids, named the way the store page names them. Derived on
# 2026-10-10 by pairing GetItems' rows with stored HTML scrapes of the same games
# (row order is the same; one game lists all 102 languages). 29 never appeared.
ELANGUAGE_NAMES: dict[int, str] = {
    0: "English", 1: "German", 2: "French", 3: "Italian", 4: "Korean",
    5: "Spanish - Spain", 6: "Simplified Chinese", 7: "Traditional Chinese",
    8: "Russian", 9: "Thai", 10: "Japanese", 11: "Portuguese - Portugal",
    12: "Polish", 13: "Danish", 14: "Dutch", 15: "Finnish", 16: "Norwegian",
    17: "Swedish", 18: "Hungarian", 19: "Czech", 20: "Romanian", 21: "Turkish",
    22: "Portuguese - Brazil", 23: "Bulgarian", 24: "Greek", 25: "Arabic",
    26: "Ukrainian", 27: "Spanish - Latin America", 28: "Vietnamese",
    30: "Indonesian", 31: "Malay",
}

# The long tail, which GetItems reports as elanguage -1 plus an
# eadditionallanguage id. Same derivation; 25 and 38 never appeared.
ADDITIONAL_LANGUAGE_NAMES: dict[int, str] = {
    0: "Afrikaans", 1: "Albanian", 2: "Amharic", 3: "Armenian", 4: "Assamese",
    5: "Azerbaijani", 6: "Bangla", 7: "Basque", 8: "Belarusian", 9: "Bosnian",
    10: "Catalan", 11: "Cherokee", 12: "Croatian", 13: "Dari", 14: "Estonian",
    15: "Filipino", 16: "Galician", 17: "Georgian", 18: "Gujarati",
    19: "Punjabi (Gurmukhi)", 20: "Hausa", 21: "Hebrew", 22: "Hindi",
    23: "Icelandic", 24: "Igbo", 26: "Irish", 27: "Kannada", 28: "Kazakh",
    29: "Khmer", 30: "K'iche'", 31: "Kinyarwanda", 32: "Konkani", 33: "Kyrgyz",
    34: "Latvian", 35: "Lithuanian", 36: "Luxembourgish", 37: "Macedonian",
    39: "Malayalam", 40: "Maltese", 41: "Maori", 42: "Marathi", 43: "Mongolian",
    44: "Nepali", 45: "Odia", 46: "Persian", 47: "Quechua", 48: "Scots",
    49: "Serbian", 50: "Punjabi (Shahmukhi)", 51: "Sindhi", 52: "Sinhala",
    53: "Slovak", 54: "Slovenian", 55: "Sorani", 56: "Sotho", 57: "Swahili",
    58: "Tajik", 59: "Tamil", 60: "Tatar", 61: "Telugu", 62: "Tigrinya",
    63: "Tswana", 64: "Turkmen", 65: "Urdu", 66: "Uyghur", 67: "Uzbek",
    68: "Valencian", 69: "Welsh", 70: "Wolof", 71: "Xhosa", 72: "Yoruba",
    73: "Zulu",
}


def _int(value, default: int = -1) -> int:
    # Protobuf int64 fields arrive as JSON strings ("999"); int32 as numbers.
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def language_name(row: dict) -> Optional[str]:
    """The store page's name for one supported_languages row, or None if the id
    is one we have never seen - a raw id is never stored."""
    base = _int(row.get("elanguage"))
    if base >= 0:
        return ELANGUAGE_NAMES.get(base)
    extra = _int(row.get("eadditionallanguage"))
    if extra >= 0:
        return ADDITIONAL_LANGUAGE_NAMES.get(extra)
    return None


def parse_store_item(item: dict, tag_names: dict[int, str]) -> dict:
    """One GetItems item in scraper.scrape_store_page()'s shape.

    has_paid_dlc is None: an item says nothing about a game's DLC, and None is
    what tells apply_scraped()/apply_store_page() to leave the stored value
    alone. Rows follow the page's rules - a language with none of the three
    columns ticked is not listed, a tag at most once (case-insensitively).
    anti_cheat is the developer's disclosure (core/anticheat.py), None for none.
    """
    languages, details = [], []
    for row in item.get("supported_languages") or []:
        name = language_name(row)
        interface = bool(row.get("supported"))
        audio = bool(row.get("full_audio"))
        subtitles = bool(row.get("subtitles"))
        if not name or name in languages or not (interface or audio or subtitles):
            continue
        languages.append(name)
        details.append({
            "name": name,
            "interface": interface,
            "audio": audio,
            "subtitles": subtitles,
        })

    tags, seen = [], set()
    ids = [_int(t.get("tagid")) for t in item.get("tags") or [] if isinstance(t, dict)]
    for tagid in ids or [_int(t) for t in item.get("tagids") or []]:
        name = tag_names.get(tagid)
        if name and name.lower() not in seen:
            tags.append(name)
            seen.add(name.lower())

    return {
        "languages": languages,
        "language_details": details,
        "tags": tags,
        "has_paid_dlc": None,
        "anti_cheat": from_store_item(item),
    }


def review_summary(item: Optional[dict]) -> Optional[tuple[int, int, str]]:
    """(review_count, percent_positive, label) from an item asked for with
    include_reviews - Steam's own summary, the one its store shows - or None
    when the item says nothing usable: no item, no summary, a count without a
    percentage. A count of 0 comes back as (0, 0, ""), and is NOT to be
    trusted on its own: the summary has said 0 for a game with thousands of
    reviews (845070, 2026-10-23), and lags behind a new game's first ones.

    percent_positive is floored, as on the store, where round() would round
    up (85 for Counter-Strike 2, which round() had made 86).
    """
    summary = ((item or {}).get("reviews") or {}).get("summary_filtered")
    if not isinstance(summary, dict):
        return None
    count = _int(summary.get("review_count"))
    if count < 0:
        return None
    if count == 0:
        return (0, 0, "")
    pct = _int(summary.get("percent_positive"))
    if not 0 <= pct <= 100:
        return None
    return (count, pct, str(summary.get("review_score_label") or "").strip())


# Why Steam's store says a game may no longer belong in the catalogue
# (screen_item), for purge_unhealthy.py to confirm with appdetails.
UNKNOWN = "unknown"          # Steam does not know the app (success 15)
HIDDEN = "hidden"            # visible: false
UNLISTED = "unlisted"        # taken off the store
COMING_SOON = "coming_soon"  # not released (any more, or yet)
NOT_FREE = "not_free"        # no is_free flag


def screen_item(item: Optional[dict]) -> Optional[str]:
    """Why an item asked for with include_release flags its game, or None
    for a game that is on the store, released and free. `item` None means
    Steam answered the batch without it: an app it does not know.

    Only a flag, never a verdict: purge_unhealthy.py removes a game only
    when appdetails agrees. `type` is not read - a free mod is in the
    catalogue on purpose (Black Reliquary); that check belongs to ingest.
    """
    if item is None:
        return UNKNOWN
    if item.get("visible") is False:
        return HIDDEN
    if item.get("unlisted"):
        return UNLISTED
    if (item.get("release") or {}).get("is_coming_soon"):
        return COMING_SOON
    if not item.get("is_free"):
        return NOT_FREE
    return None


def paid_dlc_from_items(items: Iterable[dict]) -> Optional[bool]:
    """Whether any of these DLC items costs money. None when there is no item to
    judge by (every DLC hidden, or the request failed): unknown, not "free".

    A DLC on a 100%-off promotion still has an original price, and is still paid
    DLC; the store page, which shows only the final price, would miss it.
    """
    seen = False
    for item in items:
        seen = True
        option = item.get("best_purchase_option") or {}
        if (_int(option.get("final_price_in_cents"), 0) > 0
                or _int(option.get("original_price_in_cents"), 0) > 0):
            return True
    return False if seen else None
