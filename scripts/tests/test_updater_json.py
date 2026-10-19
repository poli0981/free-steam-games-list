"""How updater_json.py points a desktop release's latest.json at its downloads."""
import pytest

import updater_json

TAG = "desktop-v2.2.1"
API = "https://api.github.com/repos/poli0981/free-steam-games-list/releases/assets/"
DL = f"https://github.com/poli0981/free-steam-games-list/releases/download/{TAG}/"
NAMES = {"11": "F2P.Tracker_2.2.1_amd64.AppImage", "12": "F2P.Tracker_2.2.1_x64_en-US.msi"}
SIGS = {"F2P.Tracker_2.2.1_amd64.AppImage": "sig-appimage\n", "F2P.Tracker_2.2.1_x64_en-US.msi": "sig-msi"}


def _doc(**platforms):
    return {"version": "2.2.1", "notes": "n", "pub_date": "2026-10-19T02:46:55Z", "platforms": platforms}


def test_api_urls_become_release_downloads():
    doc = _doc(**{
        "linux-x86_64": {"signature": "sig-appimage", "url": API + "11"},
        "windows-x86_64": {"signature": "sig-msi", "url": API + "12"},
    })
    out = updater_json.rewrite(doc, TAG, NAMES, SIGS)
    assert out["platforms"]["linux-x86_64"]["url"] == DL + "F2P.Tracker_2.2.1_amd64.AppImage"
    assert out["platforms"]["windows-x86_64"]["url"] == DL + "F2P.Tracker_2.2.1_x64_en-US.msi"
    assert out["platforms"]["linux-x86_64"]["signature"] == "sig-appimage"
    assert {k: out[k] for k in ("version", "notes", "pub_date")} == {k: doc[k] for k in ("version", "notes", "pub_date")}


def test_a_second_run_changes_nothing():
    doc = _doc(**{"linux-x86_64": {"signature": "sig-appimage", "url": API + "11"}})
    once = updater_json.rewrite(doc, TAG, NAMES, SIGS)
    assert updater_json.rewrite(once, TAG, NAMES, SIGS) == once


@pytest.mark.parametrize("doc, why", [
    (_doc(**{"linux-x86_64": {"signature": "sig-appimage", "url": API + "11"}}) | {"version": "2.2.0"}, "version"),
    ({"version": "2.2.1", "platforms": {}}, "no platform"),
    (_doc(**{"linux-x86_64": {"signature": "sig-appimage", "url": API + "99"}}), "not one of"),
    (_doc(**{"linux-x86_64": {"signature": "sig-msi", "url": API + "11"}}), "signature"),
    (_doc(**{"linux-x86_64": {"signature": "", "url": API + "11"}}), "signature"),
    (_doc(**{"linux-x86_64": {"signature": "sig-appimage", "url": "https://example.com/x.AppImage"}}), "unexpected URL"),
    (_doc(**{"linux-x86_64": {"signature": "sig-appimage",
                              "url": "https://github.com/poli0981/free-steam-games-list/releases/download/desktop-v2.2.0/F2P.Tracker_2.2.1_amd64.AppImage"}}),
     "unexpected URL"),
])
def test_anything_the_updater_feed_would_refuse_fails_loudly(doc, why):
    with pytest.raises(ValueError, match=why):
        updater_json.rewrite(doc, TAG, NAMES, SIGS)
