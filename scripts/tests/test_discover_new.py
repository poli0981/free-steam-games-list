"""How discover_new reads the redirect Cloudflare Access answers with, the
search rows, and the languages a candidate carries to the review queue."""
import pytest

import discover_new


def test_an_access_login_redirect_is_explained():
    out = discover_new._describe_access_redirect(
        "https://team.cloudflareaccess.com/cdn-cgi/access/login/free-steam-games.win?meta=a.e30.b"
    )
    assert out.startswith("Cloudflare Access redirected to its LOGIN PAGE")


def test_a_lookalike_host_is_not_taken_for_access():
    # Without the dot in the suffix check, this host also "ended with
    # cloudflareaccess.com" (CodeQL py/incomplete-url-substring-sanitization).
    out = discover_new._describe_access_redirect("https://evilcloudflareaccess.com/cdn-cgi/access/login/x")
    assert out.startswith("unexpected redirect to")


def test_removed_games_count_as_known(tmp_path, monkeypatch):
    # A game the maintainer took out must not be proposed again; the D1
    # decision is one fence, the blocklist read here is the other.
    import os
    from core import data_store
    from core.blocklist import make_entry, serialize_entry

    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    data_store.save_main([{"link": "https://store.steampowered.com/app/1/", "name": "One"}],
                         apply_human_overrides=False)
    with open(os.path.join("data", "blocklist.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        f.write(serialize_entry(make_entry("2", "Two", "not_free", "", "2026-10-13T12:00:00Z")) + "\n")
    assert discover_new.catalogue_appids() == {"1", "2"}


# Written against the row regex parse_search_rows used before it became a
# linear scan (SonarCloud python:S8786); every case is behaviour that existed.
SEARCH_HTML = """
<a href="https://store.steampowered.com/app/570/Dota_2/?snr=1_7_7_230_150_1" data-ds-appid="570" data-ds-itemkey="App_570" class="search_result_row ds_collapse_flag " data-search-page="1">
  <div class="responsive_search_name_combined">
    <div class="col search_name ellipsis"><span class="title">Dota 2</span></div>
    <div class="search_released responsive_secondrow">Jul 9, 2013</div>
  </div>
</a>
<a href="https://store.steampowered.com/sub/123/" data-ds-packageid="123" data-ds-appid="10,20" class="search_result_row"><span class="title">A Bundle</span></a>
<a href="https://store.steampowered.com/app/1/" data-ds-appid="1" class="search_result_row"><span class="title">Flip &amp; Shop</span><div class="search_released responsive_secondrow">  Coming soon  </div></a>
<a href="#" class="pagination">2</a>
<a href="https://store.steampowered.com/app/2/" data-ds-appid="2"><span class="title"><b>Bold</b> Name</span></a>
<a data-ds-appid="4"><span class="title">Four</span><a href="y">inner</a> tail</a>
<a data-ds-appid="7" data-ds-appid="8"><span class="title">Twice</span></a>
<a data-ds-appid="99"><span class="title">Never closed</span>
"""


def test_search_rows_are_read_from_each_anchor():
    assert discover_new.parse_search_rows(SEARCH_HTML) == [
        ("570", "Dota 2", "Jul 9, 2013"),
        ("1", "Flip & Shop", "Coming soon"),
        ("2", "Bold Name", ""),
        ("4", "Four", ""),
        ("8", "Twice", ""),
    ]


def test_appids_outside_anchors_are_still_recovered():
    # A markup change that drops the anchors degrades to "fetch details for
    # everything" instead of finding nothing.
    assert discover_new.parse_search_rows('<div data-ds-appid="5"></div><div data-ds-appid="x"></div>') == [
        ("5", "", ""),
    ]


def test_a_page_cut_off_inside_a_tag_keeps_the_rows_before_it():
    html = '<a data-ds-appid="570"><span class="title">Dota 2</span></a><a data-ds-appid="730"'
    assert discover_new.parse_search_rows(html) == [("570", "Dota 2", "")]


@pytest.mark.parametrize("text, expected", [
    # 5118700 as appdetails answered it on 2026-10-30.
    ("Japanese", ["Japanese"]),
    ("English<strong>*</strong>, Simplified Chinese<strong>*</strong>, Japanese"
     "<br><strong>*</strong>languages with full audio support",
     ["English", "Simplified Chinese", "Japanese"]),
    ("Korean<br/><strong>*</strong>languages with full audio support", ["Korean"]),
    ("Spanish - Spain, Portuguese - Brazil<BR />footnote", ["Spanish - Spain", "Portuguese - Brazil"]),
    ("Fran&ccedil;ais , , Deutsch", ["Français", "Deutsch"]),
    ("", []),
    (None, []),
    (["English"], []),                      # not the shape Steam sends
])
def test_appdetails_languages(text, expected):
    assert discover_new.appdetails_languages(text) == expected


def test_appdetails_languages_are_capped():
    text = ", ".join(f"Lang{i}" for i in range(60))
    assert len(discover_new.appdetails_languages(text)) == discover_new.MAX_LANGUAGES


def test_a_candidate_carries_its_languages():
    data = {"name": "//トロイメライ・ノクターン", "type": "game", "is_free": True,
            "supported_languages": "Japanese", "release_date": {"date": "Oct 16, 2026"}}
    cand = discover_new.Candidate("5118700", data)
    assert cand.link == "https://store.steampowered.com/app/5118700/"
    assert cand.to_wire()["payload"]["languages"] == ["Japanese"]
    assert discover_new.Candidate("1", {}).payload["languages"] == []


@pytest.mark.parametrize("languages, note", [
    (["English", "Japanese"], ""),
    (["Japanese"], "no English: Japanese"),
    (["Korean", "Japanese", "Thai", "Russian"], "no English: Korean, Japanese, Thai, ..."),
    ([], "no languages declared"),
])
def test_language_note(languages, note):
    assert discover_new.language_note(languages) == note


def test_candidates_without_english_are_counted():
    cands = [discover_new.Candidate(str(i), {"supported_languages": s})
             for i, s in enumerate(["English", "Japanese", "", "English, Korean"])]
    assert discover_new.without_english(cands) == 2
