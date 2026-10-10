"""
core/normalize.py runs inside save_main() on every record of every write, so
these pin what makes that safe: one release-date shape out of every shape Steam
writes, nothing it cannot read is ever changed, a second pass changes nothing,
and none of it is news (last_updated stays, a repeat save is byte-identical).

Run from the repository root:  python -m pytest scripts/tests
"""
import json
import os

import pytest

from core import data_store
from core.normalize import (
    clean_list, clean_text, decode_entities, decode_tags, normalize_record,
    normalize_release_date, translate_notes,
)


# ──────────── release_date ────────────

@pytest.mark.parametrize("raw, expected", [
    ("Aug 21, 2012", "Aug 21, 2012"),
    ("21 Aug, 2012", "Aug 21, 2012"),
    ("Dec 6, 2025", "Dec 6, 2025"),
    ("August 21, 2012", "Aug 21, 2012"),
    ("21 August 2012", "Aug 21, 2012"),
    ("Sept 3, 2025", "Sep 3, 2025"),
    (" 21  Aug,  2012 ", "Aug 21, 2012"),
    ("2012-08-21", "Aug 21, 2012"),
    # What appdetails?l=<language> returned for Wuthering Waves (2025-04-28)
    # and Isekai: Waifu Overlord (2026-09-25) on 2026-10-10.
    ("28 Thg04, 2025", "Apr 28, 2025"),            # vietnamese
    ("28 tháng 4, 2025", "Apr 28, 2025"),
    ("28 апр. 2025 г.", "Apr 28, 2025"),           # russian
    ("3 мая 2024 г.", "May 3, 2024"),
    ("25 сен. 2026 г.", "Sep 25, 2026"),
    ("2025 年 4 月 28 日", "Apr 28, 2025"),         # schinese
    ("2025年4月28日", "Apr 28, 2025"),              # japanese
    ("2025년 4월 28일", "Apr 28, 2025"),            # koreana
    ("28. Apr. 2025", "Apr 28, 2025"),             # german
    ("25. Sep. 2026", "Sep 25, 2026"),
    ("28 avr. 2025", "Apr 28, 2025"),              # french
    ("25 sept. 2026", "Sep 25, 2026"),
    ("3 juin 2024", "Jun 3, 2024"),
    ("3 juil. 2024", "Jul 3, 2024"),
    ("28 ABR 2025", "Apr 28, 2025"),               # spanish
    ("28/abr./2025", "Apr 28, 2025"),              # brazilian
    ("28 kwietnia 2025", "Apr 28, 2025"),          # polish
    ("28 Nis 2025", "Apr 28, 2025"),               # turkish
    ("25 set 2026", "Sep 25, 2026"),               # italian
    ("25 верес. 2026", "Sep 25, 2026"),            # ukrainian
])
def test_every_full_date_comes_out_in_the_one_shape(raw, expected):
    assert normalize_release_date(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "N/A", "Coming soon", "To be announced", "TBA", "Q1 2026", "2026",
    "Aug 2026", "Summer 2026", "Feb 30, 2025", "31 Nov, 2024", "13/2025",
])
def test_anything_that_is_not_a_full_date_is_kept_verbatim(raw):
    assert normalize_release_date(raw) == raw


def test_a_non_string_is_left_alone():
    assert normalize_release_date(None) is None


def test_the_shape_is_a_fixed_point():
    for raw in ("21 Aug, 2012", "28 апр. 2025 г.", "2025年4月28日", "Coming soon"):
        once = normalize_release_date(raw)
        assert normalize_release_date(once) == once


# ──────────── Text ────────────

@pytest.mark.parametrize("raw, expected", [
    (" Rabid Troll Studios", "Rabid Troll Studios"),
    ("Astral Party ", "Astral Party"),
    ("Raffiné Studio\t", "Raffiné Studio"),
    ("Fire from the sky: Cagliari 1943\xa0VR", "Fire from the sky: Cagliari 1943 VR"),
    ("Stuffed  Wombat", "Stuffed Wombat"),
    ("Gameforge 4D GmbH‬", "Gameforge 4D GmbH"),
    ("​Triple Fantasy", "Triple Fantasy"),
    ("Wilma Wiiand​​", "Wilma Wiiand"),
    ("YAMAYURI ‌‌‍‍‍​‍‌‌GAMES", "YAMAYURI GAMES"),
    # Kept: real names in any script, an ideographic space, a single ZWNJ
    # (Persian spelling) and a single ZWJ (an emoji sequence).
    ("千鳥豚工作室", "千鳥豚工作室"),
    ("鳥獣妖怪戯画　(Choju Yokai Giga)", "鳥獣妖怪戯画　(Choju Yokai Giga)"),
    ("می‌خواهم", "می‌خواهم"),
    ("Pocket Rocket Studio 🚀", "Pocket Rocket Studio 🚀"),
    ("👨‍🚀 Studio", "👨‍🚀 Studio"),
])
def test_names_lose_only_invisible_characters_and_stray_whitespace(raw, expected):
    assert clean_text(raw) == expected
    assert clean_text(expected) == expected


def test_a_blurb_keeps_its_line_breaks():
    assert clean_text("Let's start typing!\r\nDiscover​ more ", single_line=False) == \
        "Let's start typing!\r\nDiscover more"


def test_a_name_left_empty_is_dropped_from_its_list():
    assert clean_list([" "]) == []
    assert clean_list(["Voxel School", " Padaone Games"]) == ["Voxel School", "Padaone Games"]


# ──────────── HTML entities ────────────

def test_escaped_text_is_decoded_once():
    assert decode_entities("an art &quot;game&quot; &amp; more") == 'an art "game" & more'
    assert decode_entities("&#39;quoted&#x27;") == "'quoted'"
    # Only references with a semicolon: these are words, not entities.
    assert decode_entities("this&not that, R&D, AT&T") == "this&not that, R&D, AT&T"
    assert decode_entities("&madeup;") == "&madeup;"


def test_tags_are_decoded_and_the_duplicates_that_makes_are_dropped():
    assert decode_tags(["Point &amp; Click", "Puzzle", "Point & Click"]) == ["Point & Click", "Puzzle"]


# ──────────── notes ────────────

@pytest.mark.parametrize("raw, expected", [
    ("Có DLC trả phí", "Has paid DLC"),
    ("Có DLC trả phí 💀 Dead game (no players ≥14d)", "Has paid DLC 💀 Dead game (no players ≥14d)"),
    ("Có DLC trả phí; Easy Anti-Cheat [Kernel]", "Has paid DLC; Easy Anti-Cheat [Kernel]"),
    ("Not reviewed yet", "Not reviewed yet"),
    ("English only", "English only"),
])
def test_the_extensions_vietnamese_notes_read_in_english(raw, expected):
    assert translate_notes(raw) == expected


# ──────────── Records ────────────

def test_a_record_only_has_its_own_fields_touched():
    game = {"link": "https://store.steampowered.com/app/1/", "release_date": "21 Aug, 2012"}
    assert normalize_record(game) == ["release_date"]
    assert game == {"link": "https://store.steampowered.com/app/1/", "release_date": "Aug 21, 2012"}


def _messy(appid: int) -> dict:
    return {
        "link": f"https://store.steampowered.com/app/{appid}/",
        "name": "​Triple Fantasy ",
        "developer": ["Wilma Wiiand​​"],
        "publisher": [" "],
        "release_date": "28 апр. 2025 г.",
        "description": "an art &quot;game&quot;",
        "tags": ["Point &amp; Click"],
        "notes": "Có DLC trả phí",
        "last_updated": "2026-01-01T00:00:00Z",
    }


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    """A scratch repository root, as in test_index_hash.py."""
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    return tmp_path


def _shards() -> dict:
    return {name: open(os.path.join("data", name), "rb").read()
            for name in sorted(os.listdir("data")) if name.endswith((".jsonl", ".json"))}


def test_save_main_writes_every_record_normalised_and_none_as_news(workdir):
    data_store.save_main([_messy(1)], apply_human_overrides=False)
    [stored] = data_store.load_main()
    assert stored["name"] == "Triple Fantasy"
    assert stored["developer"] == ["Wilma Wiiand"]
    assert stored["publisher"] == []
    assert stored["release_date"] == "Apr 28, 2025"
    assert stored["description"] == 'an art "game"'
    assert stored["tags"] == ["Point & Click"]
    assert stored["notes"] == "Has paid DLC"
    assert stored["last_updated"] == "2026-01-01T00:00:00Z"


def test_saving_what_was_loaded_changes_no_byte(workdir):
    data_store.save_main([_messy(1), _messy(2)], apply_human_overrides=False)
    before = _shards()
    data_store.save_main(data_store.load_main(), apply_human_overrides=False)
    assert _shards() == before


def test_an_override_in_vietnamese_does_not_flip_flop(workdir):
    # The override would put the phrase back after every normalisation, bump
    # last_updated and commit on every run, if it were not translated too.
    os.makedirs(os.path.join("data", "overrides"))
    with open(os.path.join("data", "overrides", "1.json"), "w", encoding="utf-8") as fh:
        json.dump({"schema": 1, "appid": "1", "fields": {
            "notes": {"value": "Có DLC trả phí; EAC", "was": "Not reviewed yet"}}}, fh)
    data_store.save_main([_messy(1)])
    before = _shards()
    [stored] = data_store.load_main()
    assert stored["notes"] == "Has paid DLC; EAC"
    data_store.save_main(data_store.load_main())
    assert _shards() == before
