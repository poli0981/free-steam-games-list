"""
core/anticheat.py reads the anti-cheat a developer declares on Steam and is the
one rule every writer applies it with. These pin how the store page and Steam's
JSON are read (the heading decides kernel, a Boot Protection row is a flag, no
other notice is an anti-cheat), how products are compared, and the rule: fill,
replace only when asked, never clear, never fight an override, and a second
pass changes nothing.

Run from the repository root:  python -m pytest scripts/tests
"""
import glob
import json
import os

import pytest

from core import anticheat as ac
from core.anticheat import Disclosure, apply_anti_cheat
from core.overrides import OverrideGuard

T = "\n\t\t\t\t\t\t\t\t\t\t"


def _section(cls: str, heading: str, *rows: tuple[str, str]) -> str:
    """The block as Steam wrote it on 2026-10-16 (Apex Legends, CoD), tabs and all."""
    names = "".join(f'{T}<div class="anticheat_name">{name}<span class="anticheat_uninstalls">{note}</span></div>'
                    for name, note in rows)
    return (f'<div class="DRM_notice">Requires 3rd-Party Account:&nbsp;EA Account</div>'
            f'{T}<div class="anticheat_section {cls}" >{T}<div>{heading}</div>{names}{T}</div>'
            f'{T}<div class="DRM_notice"data-panel="{{}}" role="button" >{T}'
            f'<div>Requires agreement to a 3rd-party EULA</div></div>')


KERNEL = "Uses Kernel Level Anti-Cheat"
SOFTWARE = "Uses Anti-Cheat Software"


# ──────────── The store page ────────────

def test_a_kernel_section_and_its_uninstall_span():
    page = _section("DRM_notice", KERNEL, ("Easy Anti-Cheat", " - Requires manual removal after game uninstall"))
    assert ac.parse_page(page) == Disclosure("Easy Anti-Cheat", True, False)


def test_kernel_comes_from_the_heading_not_the_class():
    # Jujutsu Kaisen: DRM_notice, yet "Uses Anti-Cheat Software" - its boot
    # protection is what earns the class.
    page = _section("DRM_notice", SOFTWARE, ("Fairguard", ""), ("Boot Protection", " - Requires both Secure Boot & TPM 2.0"))
    assert ac.parse_page(page) == Disclosure("Fairguard", False, True)
    page = _section("anticheat_nonkernel_notice", KERNEL, ("VAC (Valve Anti-Cheat)", ""))
    assert ac.parse_page(page).kernel is True
    page = _section("DRM_notice", "Dùng chống gian lận cấp độ kernel", ("Easy Anti-Cheat", ""))
    assert ac.parse_page(page).kernel is None      # a heading it cannot read


def test_boot_protection_is_a_flag_not_a_name():
    page = _section("DRM_notice", KERNEL, ("RICOCHET Anti-Cheat", ""),
                    ("Boot Protection", " - Requires both Secure Boot & TPM 2.0"))
    assert ac.parse_page(page) == Disclosure("RICOCHET Anti-Cheat", True, True)


def test_names_are_cleaned_and_an_empty_one_stays_empty():
    assert ac.parse_page(_section("DRM_notice", KERNEL, ("KSS (Krafton Security Services) ", ""))).name == \
        "KSS (Krafton Security Services)"
    assert ac.parse_page(_section("DRM_notice", KERNEL, ("Stand &amp; Deliver AC", ""))).name == "Stand & Deliver AC"
    assert ac.parse_page(_section("anticheat_nonkernel_notice", SOFTWARE, ("", ""))) == Disclosure("", False, False)


def test_other_notices_prose_and_deck_json_are_not_anti_cheat():
    page = ('<div class="DRM_notice"><div>Requires 3rd-Party Account: EA Account</div></div>'
            '<div class="game_area_description">Our new anti-cheat technologies, kernel level.</div>'
            '<script>{"SteamDeckVerified_TestResult_UnsupportedAntiCheat_Other": 1}</script>'
            '<img src="anti_cheats_1202_ru.gif">')
    assert ac.parse_page(page) is None
    assert ac.parse_page("") is None and ac.parse_page(None) is None


# ──────────── Steam's JSON ────────────

def _item(anticheat=None, extra=True) -> dict:
    item = {"id": 1, "success": 1}
    if extra:
        item["extra_details"] = {} if anticheat is None else {"anticheat": anticheat}
    return item


def test_store_item_disclosures():
    # Measured 2026-10-16.
    delta = {"kernel_mode": True, "uninstall_completely": True,
             "name": "Anti-Cheat Expert (ACE)", "name_loc": "#Store_AntiCheat_Type_ace"}
    assert ac.from_store_item(_item(delta)) == Disclosure("Anti-Cheat Expert (ACE)", True, False)
    assert ac.from_store_item(_item({"kernel_mode": True, "uninstall_completely": True})) == \
        Disclosure("", True, False)                                         # PUBG
    assert ac.from_store_item(_item({})) == Disclosure("", False, False)    # Marvel Rivals
    assert ac.from_store_item(_item({"name": "VAC (Valve Anti-Cheat)"})) == \
        Disclosure("VAC (Valve Anti-Cheat)", False, False)                  # CS2
    cod = {"kernel_mode": True, "boot_protection": True, "boot_protection_name": "secureboot_tpm2"}
    assert ac.from_store_item(_item(cod)) == Disclosure("", True, True)
    assert ac.from_store_item(_item()) is None                              # Warframe
    assert ac.from_store_item(_item(extra=False)) is None
    assert ac.from_store_item(None) is None


def test_the_page_names_what_the_json_leaves_out():
    api = Disclosure("", True, True)
    page = Disclosure("RICOCHET Anti-Cheat", True, False)
    assert ac.combine(api, page) == Disclosure("RICOCHET Anti-Cheat", True, True)
    assert ac.combine(api, None) == api
    assert ac.combine(None, page) == page
    named = Disclosure("Easy Anti-Cheat", True, False)
    assert ac.combine(named, Disclosure("", False, False)) == named        # JSON decides kernel


def test_category_vac_in_any_position():
    cats = [{"id": 1, "description": "Multi-player"}, {"id": 2, "description": "Single-player"},
            {"id": 8, "description": "Valve Anti-Cheat enabled"}]
    assert ac.from_categories(cats) == ac.VAC
    assert ac.from_categories([{"description": "Valve Anti-Cheat enabled"}]) == ac.VAC
    assert ac.from_categories([{"id": 1, "description": "Multi-player"}]) is None
    assert ac.from_categories(None) is None


# ──────────── Labels ────────────

@pytest.mark.parametrize("name, label", [
    ("Easy Anti-Cheat", "EAC"),
    ("VAC (Valve Anti-Cheat)", "VAC"),
    ("VAC (Valve Anti-Cheat); additional custom server-side anti-cheat on dedicated servers", "VAC"),
    ("BattlEye", "BattlEye"),
    ("nProtect GameGuard", "nProtect"),
    ("XIGNCODE3", "XIGNCODE"),
    ("KSS (Krafton Security Services)", "KSS"),
    ("NetEase Game Security", "NetEase GS"),
    ("RICOCHET Anti-Cheat", "Ricochet"),
    ("Denuvo", "Denuvo AC"),
    ("FACEIT Anti-Cheat", "FACEIT AC"),
    # Added when Steam's disclosures came in (v4.3.2).
    ("Anti-Cheat Expert (ACE)", "ACE"),
    ("ACE", "ACE"),
    ("Anti-Cheat Toolkit", "Anti-Cheat Toolkit"),
    ("Anti-Cheat Toolkit 2024", "Anti-Cheat Toolkit"),
    ("CrackProof®", "CrackProof"),
    ("HoYoKProtect", "HoYoKProtect"),
    ("NGS (Nexon Game Security)", "NGS"),
    ("Nexon Game Security", "NGS"),
    ("EA Javelin AntiCheat", "EA Javelin"),
    ("SARD Anti-Cheat & LSS Security", "SARD"),
    # Not a known product: Steam's name, as it is.
    ("Fairguard", "Fairguard"),
    ("IRONSHIELD", "IRONSHIELD"),
])
def test_labels(name, label):
    assert ac.label(name) == label


@pytest.mark.parametrize("name, key", [
    # A key or a pattern counts only as whole words: "ace" is in all of these.
    ("FACEIT AC", "FACEIT AC"),
    ("Space Guard", None),
    ("Interface Shield", None),
    ("Peacekeeper", None),
    ("Vacuum Protect", None),
    ("Sardine Shield", None),
    ("Kssentials", None),
    ("Strinova ACE", "ACE"),
    ("EasyAntiCheat_EOS", "EAC"),
    ("XIGNCODE3", "XIGNCODE"),
])
def test_names_match_as_whole_words(name, key):
    assert ac.canonical(name) == key


FRONTIER = ("Frontier uses SCUE4 as its anti-cheat, which comes pre-built with the game. It operates "
            "at the user level and scans surface memory for unauthorized injections or cheat "
            "applications affecting the game. It does not install a separate anti-cheat client.")


def test_a_paragraph_where_the_name_goes_is_cut_on_a_word():
    # Frontier: Battle Royale, 2026-10-16. The note keeps all of it.
    cut = ac.label(FRONTIER)
    assert cut == "Frontier uses SCUE4 as its anti-cheat…"
    assert len(cut) <= ac.LABEL_MAX
    assert ac.label(cut) == cut
    assert ac.same_family(cut, FRONTIER) and ac.same_family(FRONTIER, cut)
    assert not ac.same_family("Frontier uses SCUE4 as its anti-cheat…", "Frontier uses EAC")
    game = _game()
    apply_anti_cheat(game, Disclosure(FRONTIER, False))
    assert (game["anti_cheat"], game["anti_cheat_note"]) == (cut, f"{FRONTIER} [Non-Kernel]")


def test_products_are_compared_by_family():
    assert ac.same_family("EAC", "Easy Anti-Cheat")
    assert ac.same_family("Easy Anti-Cheat", "EAC")
    assert ac.same_family("nProtect", "nProtect GameGuard")
    assert ac.same_family("Krafton Security Services", "KSS (Krafton Security Services)")
    assert ac.same_family("ACE", "Anti-Cheat Expert (ACE)")
    assert ac.same_family("CrackProof®", "CrackProof")
    assert ac.same_family("网易游戏安全", "网易游戏安全")
    assert not ac.same_family("EAC", "Anti-Cheat Expert (ACE)")
    assert not ac.same_family("EAC", "BattlEye")
    assert not ac.same_family("FACEIT AC", "Anti-Cheat Expert (ACE)")


def _stored_anti_cheats() -> list[str]:
    root = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    out = set()
    for path in glob.glob(os.path.join(root, "data_*.jsonl")):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                value = json.loads(line).get("anti_cheat") if line.strip() else None
                if isinstance(value, str) and value.strip() not in ("", "-"):
                    out.add(value)
    return sorted(out)


def test_every_stored_value_and_every_label_is_its_own_family():
    # What makes a second sweep a no-op: a value the sweep wrote, or one already
    # there, is the same product as the name it came from.
    values = _stored_anti_cheats() + ["EAC", "Anti-Cheat Expert (ACE)", "Server-side", "-x-"]
    for value in values:
        assert ac.same_family(value, value), value
        assert ac.same_family(ac.label(value), value), value


# ──────────── The rule ────────────

def _game(**fields) -> dict:
    base = {"link": "https://store.steampowered.com/app/2507950/", "name": "Delta Force",
            "anti_cheat": "-", "anti_cheat_note": "", "is_kernel_ac": None}
    base.update(fields)
    return base


ACE = Disclosure("Anti-Cheat Expert (ACE)", True, False)


def test_an_empty_game_gets_all_three():
    game = _game()
    assert sorted(apply_anti_cheat(game, ACE)) == ["anti_cheat", "anti_cheat_note", "is_kernel_ac"]
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == \
        ("ACE", "Anti-Cheat Expert (ACE) [Kernel]", True)
    game = _game(anti_cheat="")
    apply_anti_cheat(game, Disclosure("RICOCHET Anti-Cheat", True, True))
    assert (game["anti_cheat"], game["anti_cheat_note"]) == ("Ricochet", "RICOCHET Anti-Cheat [Kernel]; Boot Protection")


def test_nothing_found_or_nothing_named_changes_nothing():
    for found in (None, Disclosure("", True, False)):
        for game in (_game(), _game(anti_cheat="EAC", is_kernel_ac=None)):
            before = dict(game)
            assert apply_anti_cheat(game, found, replace=True) == []
            assert game == before


def test_the_same_product_fills_and_follows_steam():
    # Marvel Rivals: named, kernel unknown, no note.
    game = _game(anti_cheat="NetEase Game Security")
    assert sorted(apply_anti_cheat(game, Disclosure("NetEase Game Security", False))) == \
        ["anti_cheat_note", "is_kernel_ac"]
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == \
        ("NetEase Game Security", "NetEase Game Security [Non-Kernel]", False)
    # Filling never moves a known flag; the sweep (replace) does.
    game = _game(anti_cheat="Fairguard", anti_cheat_note="Fairguard [Kernel]", is_kernel_ac=True)
    assert apply_anti_cheat(game, Disclosure("Fairguard", False, True)) == []
    assert sorted(apply_anti_cheat(game, Disclosure("Fairguard", False, True), replace=True)) == \
        ["anti_cheat_note", "is_kernel_ac"]
    assert (game["anti_cheat_note"], game["is_kernel_ac"]) == ("Fairguard [Non-Kernel]", False)


def test_a_kernel_change_rewrites_only_a_machine_suffix():
    game = _game(anti_cheat="EAC", anti_cheat_note="Kernel driver, uninstall it by hand", is_kernel_ac=False)
    assert apply_anti_cheat(game, Disclosure("Easy Anti-Cheat", True), replace=True) == ["is_kernel_ac"]
    assert game["anti_cheat_note"] == "Kernel driver, uninstall it by hand"


def test_another_product_is_replaced_only_by_the_sweep():
    # Wuthering Waves: stored EAC, Steam says ACE.
    game = _game(anti_cheat="EAC", anti_cheat_note="EAC", is_kernel_ac=None)
    assert apply_anti_cheat(game, ACE) == []
    assert game["anti_cheat"] == "EAC"
    assert sorted(apply_anti_cheat(game, ACE, replace=True)) == ["anti_cheat", "anti_cheat_note", "is_kernel_ac"]
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == \
        ("ACE", "Anti-Cheat Expert (ACE) [Kernel]", True)


def test_a_known_label_stays_as_it_was_written():
    game = _game(anti_cheat="Easy Anti-Cheat", anti_cheat_note="Easy Anti-Cheat [Kernel]", is_kernel_ac=True)
    assert apply_anti_cheat(game, Disclosure("Easy Anti-Cheat", True), replace=True) == []


def test_applying_twice_changes_nothing():
    for found in (ACE, Disclosure("RICOCHET Anti-Cheat", True, True), ac.VAC,
                  Disclosure("VAC (Valve Anti-Cheat); additional custom server-side anti-cheat", False),
                  Disclosure("hosted game servers", False), Disclosure("Fairguard", None),
                  Disclosure(FRONTIER, False), Disclosure("K1LLSWITↃH", False)):
        for start in (_game(), _game(anti_cheat="EAC", anti_cheat_note="EAC", is_kernel_ac=True)):
            game = dict(start)
            apply_anti_cheat(game, found, replace=True)
            once = dict(game)
            assert apply_anti_cheat(game, found, replace=True) == [], found
            assert game == once


# ──────────── Overrides ────────────

def _guard(fields=None, retired=None) -> OverrideGuard:
    return OverrideGuard({"2507950": {"fields": fields or {}, "retired": retired or {}}})


def test_a_field_an_override_covers_is_not_written():
    guard = _guard({"is_kernel_ac": {"value": None}})
    game = _game()
    assert sorted(apply_anti_cheat(game, ACE, guard=guard)) == ["anti_cheat", "anti_cheat_note"]
    assert game["is_kernel_ac"] is None
    assert game["anti_cheat_note"] == "Anti-Cheat Expert (ACE)"   # the suffix follows the locked null


def test_a_locked_label_writes_nothing_for_another_product():
    guard = _guard({"anti_cheat": {"value": "BattlEye"}})
    game = _game(anti_cheat="BattlEye", is_kernel_ac=None)
    assert apply_anti_cheat(game, ACE, replace=True, guard=guard) == []
    guard = _guard({"anti_cheat": {"value": "-"}})       # an override says: none
    assert apply_anti_cheat(_game(), ACE, replace=True, guard=guard) == []
    # The same product with a locked label still gets its kernel flag and note.
    guard = _guard({"anti_cheat": {"value": "Anti-Cheat Expert (ACE)"}})
    game = _game(anti_cheat="Anti-Cheat Expert (ACE)")
    assert sorted(apply_anti_cheat(game, ACE, replace=True, guard=guard)) == ["anti_cheat_note", "is_kernel_ac"]


def test_a_locked_kernel_flag_decides_the_suffix():
    guard = _guard({"is_kernel_ac": {"value": False}})
    game = _game(is_kernel_ac=False)
    apply_anti_cheat(game, ACE, replace=True, guard=guard)
    assert (game["is_kernel_ac"], game["anti_cheat_note"]) == (False, "Anti-Cheat Expert (ACE) [Non-Kernel]")


def test_a_retired_value_is_never_written_back():
    # apply_overrides() restores `was` whenever the stored value equals the
    # retired one: writing it would flip-flop every day.
    guard = _guard(retired={"anti_cheat": {"value": "ACE", "was": "-"}})
    assert apply_anti_cheat(_game(), ACE, replace=True, guard=guard) == []
    # Another value is fine, and so is an entry whose `was` is its value.
    guard = _guard(retired={"anti_cheat": {"value": "EAC", "was": "-"},
                            "is_kernel_ac": {"value": True, "was": True}})
    assert "anti_cheat" in apply_anti_cheat(_game(), ACE, replace=True, guard=guard)


def test_an_invalid_override_entry_guards_nothing():
    # apply_overrides() rejects these, so they do not own the field either.
    guard = _guard({"anti_cheat": {"value": ""}, "is_kernel_ac": "true"})
    assert sorted(apply_anti_cheat(_game(), ACE, guard=guard)) == ["anti_cheat", "anti_cheat_note", "is_kernel_ac"]
