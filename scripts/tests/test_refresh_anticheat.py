"""
refresh_anticheat.py re-reads every game's anti-cheat disclosure from Steam
daily and lets Steam win. These pin what makes a daily writer of manual fields
safe: no disclosure and no answer never clear anything, an override is never
fought, last_updated moves only on a real change, and a second run writes the
same bytes.

Steam is never called: the client is a fake. Run from the repository root:
python -m pytest scripts/tests
"""
import json
import os

import pytest

import refresh_anticheat as rac
from core import data_store

STAMP = "2026-10-16T16:30:00Z"
OLD = "2026-01-01T00:00:00Z"


def _rec(appid: str, name: str, **fields) -> dict:
    base = {"link": f"https://store.steampowered.com/app/{appid}/", "name": name,
            "anti_cheat": "-", "anti_cheat_note": "", "is_kernel_ac": None,
            "type_game": "online", "notes": "Not reviewed yet", "last_updated": OLD}
    base.update(fields)
    return base


def _page(name: str, kernel: bool) -> str:
    heading = "Uses Kernel Level Anti-Cheat" if kernel else "Uses Anti-Cheat Software"
    cls = "DRM_notice" if kernel else "anticheat_nonkernel_notice"
    return (f'<div class="anticheat_section {cls}" >\n\t<div>{heading}</div>\n\t'
            f'<div class="anticheat_name">{name}<span class="anticheat_uninstalls"></span></div>\n</div>')


class FakeClient:
    """GetItems' extra_details.anticheat by appid (None: no disclosure), store
    pages by appid, and the appids whose batch failed."""

    def __init__(self, items=None, pages=None, failed=()):
        self.items, self.pages, self.failed = items or {}, pages or {}, set(failed)
        self.calls: list[tuple] = []

    def fetch_anticheat_items(self, appids, give_up_after=10):
        self.calls.append(("items", tuple(appids)))
        out = {}
        for a in appids:
            if a not in self.failed:
                found = self.items.get(a)
                out[a] = {"id": int(a), "success": 1,
                          "extra_details": {} if found is None else {"anticheat": found}}
        return out, {a for a in appids if a in self.failed}

    def fetch_store_page_full(self, appid):
        self.calls.append(("page", appid))
        html = self.pages.get(appid)
        return ("ok", html) if html is not None else ("network_error", None)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    monkeypatch.setattr(rac, "now_iso", lambda: STAMP)

    def run(records=None, client=None, argv=()):
        if records is not None:
            data_store.save_main(records, apply_human_overrides=False)
        monkeypatch.setattr(rac, "get_client", lambda: client)
        rac.main(list(argv))
        return {data_store.extract_appid(g["link"]): g for g in data_store.load_main()}
    return run


def _bytes() -> dict:
    return {name: open(os.path.join("data", name), "rb").read()
            for name in sorted(os.listdir("data")) if name.endswith((".jsonl", ".json"))}


def _override(appid: str, doc: dict) -> None:
    os.makedirs(os.path.join("data", "overrides"), exist_ok=True)
    with open(os.path.join("data", "overrides", f"{appid}.json"), "w", encoding="utf-8") as fh:
        json.dump({"schema": 1, "appid": appid, **doc}, fh)


# What Steam answered on 2026-10-16.
STEAM = FakeClient(
    items={
        "2507950": {"kernel_mode": True, "uninstall_completely": True, "name": "Anti-Cheat Expert (ACE)"},
        "1203220": None,                                         # NARAKA: declares none
        "578080": {"kernel_mode": True, "uninstall_completely": True},
        "2767030": {},
        "3513350": {"kernel_mode": True, "name": "Anti-Cheat Expert (ACE)"},
        "4224240": {"boot_protection": True, "boot_protection_name": "secureboot_tpm2"},
        "1252250": {},
    },
    pages={
        "578080": _page("KSS (Krafton Security Services) ", True),
        "2767030": _page("NetEase Game Security", False),
        "4224240": _page("Fairguard", False).replace(
            "</div>\n</div>", '</div>\n\t<div class="anticheat_name">Boot Protection'
                              '<span class="anticheat_uninstalls"> - Requires both Secure Boot &amp; TPM 2.0'
                              '</span></div>\n</div>'),
        "1252250": _page("", False),
    },
)

CATALOGUE = [
    _rec("2507950", "Delta Force"),
    _rec("1203220", "NARAKA: BLADEPOINT", anti_cheat="EAC", anti_cheat_note="EAC"),
    _rec("578080", "PUBG: BATTLEGROUNDS", anti_cheat="Krafton Security Services",
         anti_cheat_note="Krafton Security Services [Kernel]", is_kernel_ac=True),
    _rec("2767030", "Marvel Rivals", anti_cheat="NetEase Game Security"),
    _rec("3513350", "Wuthering Waves", anti_cheat="EAC", anti_cheat_note="Easy Anti-Cheat [Kernel]", is_kernel_ac=True),
    _rec("4224240", "Jujutsu Kaisen Phantom Parade", anti_cheat="Fairguard",
         anti_cheat_note="Fairguard [Kernel]", is_kernel_ac=True),
    _rec("1252250", "Rebornia"),
    _rec("230410", "Warframe", anti_cheat=""),
]


def test_conflicts_resolve_steam_first(repo, capsys):
    games = repo([dict(g) for g in CATALOGUE], STEAM)
    trio = {a: (g["anti_cheat"], g["anti_cheat_note"], g["is_kernel_ac"]) for a, g in games.items()}
    assert trio["2507950"] == ("ACE", "Anti-Cheat Expert (ACE) [Kernel]", True)
    assert trio["3513350"] == ("ACE", "Anti-Cheat Expert (ACE) [Kernel]", True)
    assert trio["4224240"] == ("Fairguard", "Fairguard [Non-Kernel]", False)
    assert trio["2767030"] == ("NetEase Game Security", "NetEase Game Security [Non-Kernel]", False)
    # The same product under the name the extension wrote: nothing to do.
    assert trio["578080"] == ("Krafton Security Services", "Krafton Security Services [Kernel]", True)
    out = capsys.readouterr().out
    assert "4 games changed (filled 1, replaced 1, updated 2)" in out
    assert "1252250 Rebornia" in out


def test_no_disclosure_and_no_name_never_clear_anything(repo):
    games = repo([dict(g) for g in CATALOGUE], STEAM)
    assert games["1203220"]["anti_cheat"] == "EAC"            # NARAKA declares none
    assert games["230410"]["anti_cheat"] == ""                # Warframe: not even asked about by name
    assert games["1252250"]["anti_cheat"] == "-"              # disclosed, named nowhere


def test_last_updated_moves_only_on_change(repo):
    games = repo([dict(g) for g in CATALOGUE], STEAM)
    moved = sorted(a for a, g in games.items() if g["last_updated"] == STAMP)
    assert moved == ["2507950", "2767030", "3513350", "4224240"]


def test_a_second_run_changes_no_byte(repo):
    repo([dict(g) for g in CATALOGUE], STEAM)
    before = _bytes()
    repo(client=STEAM)
    assert _bytes() == before


def test_the_page_is_read_only_for_unnamed_disclosures(repo):
    client = FakeClient(STEAM.items, STEAM.pages)
    repo([dict(g) for g in CATALOGUE], client)
    pages = sorted(a for kind, a in client.calls if kind == "page")
    assert pages == ["1252250", "2767030", "4224240", "578080"]
    assert [kind for kind, _ in client.calls].count("items") == 1


def test_a_failed_batch_is_unknown_and_reported(repo, capsys):
    client = FakeClient(STEAM.items, STEAM.pages, failed={"2507950", "3513350"})
    games = repo([dict(g) for g in CATALOGUE], client)
    assert games["2507950"]["anti_cheat"] == "-"
    assert games["3513350"]["anti_cheat"] == "EAC"
    assert games["2767030"]["is_kernel_ac"] is False          # the rest still applies
    assert "::warning::GetItems did not answer for 2 games" in capsys.readouterr().out


def test_steam_down_saves_nothing_and_exits_zero(repo, capsys):
    # Notes a save would clean, so a save of any kind would show in the bytes.
    records = [dict(g, notes="Has paid DLC") for g in CATALOGUE]
    data_store.save_main(records, apply_human_overrides=False)
    with open(os.path.join("data", "data_001.jsonl"), "w", encoding="utf-8", newline="\n") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    before = _bytes()
    repo(client=FakeClient(failed={data_store.extract_appid(g["link"]) for g in CATALOGUE}))
    assert _bytes() == before
    assert "Steam answered for no game: nothing written." in capsys.readouterr().out


def test_an_active_override_is_not_fought(repo):
    # A human said Wuthering Waves uses EAC; Steam says ACE every day.
    _override("3513350", {"fields": {"anti_cheat": {"value": "EAC"}}})
    games = repo([dict(g) for g in CATALOGUE], STEAM)
    assert games["3513350"]["anti_cheat"] == "EAC"
    assert games["3513350"]["last_updated"] == OLD
    before = _bytes()
    repo(client=STEAM)
    assert _bytes() == before


def test_a_retired_value_is_not_written_back(repo):
    # Retired: the human's ACE gave way to the old "-". Writing ACE again would
    # make apply_overrides() restore "-" on every save - a commit a day.
    _override("2507950", {"fields": {}, "retired": {"anti_cheat": {"value": "ACE", "was": "-"}}})
    games = repo([dict(g) for g in CATALOGUE], STEAM)
    assert games["2507950"]["anti_cheat"] == "-"
    before = _bytes()
    repo(client=STEAM)
    assert _bytes() == before


def test_dry_run_writes_nothing_and_appid_narrows(repo, capsys):
    repo([dict(g) for g in CATALOGUE], FakeClient())
    before = _bytes()
    client = FakeClient(STEAM.items, STEAM.pages)
    repo(client=client, argv=["--dry-run", "--appid", "2507950", "3513350"])
    assert _bytes() == before
    [(_, asked)] = [c for c in client.calls if c[0] == "items"]
    assert sorted(asked) == ["2507950", "3513350"]
    out = capsys.readouterr().out
    assert "2 games changed" in out and "Dry run: nothing written." in out
