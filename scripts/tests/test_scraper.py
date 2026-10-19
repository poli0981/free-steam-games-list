"""How core/scraper.py reads a store page's tags and language table.

Written against the regexes these parsers used before they were made linear
(SonarCloud python:S8786), so each case pins behaviour that already existed.
"""
from core.scraper import parse_language_table, parse_tags


TAGS_HTML = """
<div class="glance_tags popular_tags" data-appid="1">
<a href="https://store.steampowered.com/tags/en/Free%20to%20Play/" class="app_tag" style="display: none;">
\t\t\t\t\t\tFree to Play\t\t\t\t\t</a><a href="x" class="app_tag" style="display: none;">
\t\t\t\t\t\tPoint &amp; Click\t\t\t\t\t</a><a class = "app_tag">action</a><a class="app_tag">Action</a>
<a class="app_tag"> </a><a class="app_tag"></a><a class="app_tag"><b>Nested</b></a>
<a class="app_tag">+</a><div class="app_tag add_button">+</div><a class="app_tag">RPG &gt; JRPG</a>
</div>
"""


def test_tags_are_unescaped_trimmed_and_deduplicated():
    assert parse_tags(TAGS_HTML) == ["Free to Play", "Point & Click", "action", "RPG > JRPG"]


def test_a_page_without_tags_has_none():
    assert parse_tags('<a class="app_tagger">Nope</a><span class="app_tag">Nope</span>') == []


CHECK = '<td class="checkcol"><span>&#10004;</span></td>'
EMPTY = '<td class="checkcol"></td>'

LANGUAGE_HTML = f"""
<table class="game_language_options" cellpadding="0" cellspacing="0">
<tr><th style="width: 94px;"></th><th class="checkcol">Interface</th><th class="checkcol">Full Audio</th><th class="checkcol">Subtitles</th></tr>
<tr style="" class="">
<td style="width: 94px; text-align: left" class="ellipsis">
English</td>
{CHECK}
{CHECK}
{CHECK}
</tr>
<tr class="unsupported"><td>French</td>{CHECK}{CHECK}{CHECK}</tr>
<tr CLASS="Lang Unsupported"><td>German</td>{CHECK}{EMPTY}{EMPTY}</tr>
<tr data-class="unsupported"><td>Italian</td>{CHECK}{EMPTY}{EMPTY}</tr>
<tr class="supported"><td>Spanish - Spain</td>{EMPTY}{EMPTY}{CHECK}</tr>
<tr class="unsupported"><td style="width: 94px; text-align: left" class="ellipsis">Japanese</td><td colspan="3">Not supported</td></tr>
</table>
"""


def test_a_row_marked_unsupported_is_skipped_whatever_its_cells_say():
    out = parse_language_table(LANGUAGE_HTML)
    assert out["languages"] == ["English", "Spanish - Spain"]
    assert out["language_details"] == [
        {"name": "English", "interface": True, "audio": True, "subtitles": True},
        {"name": "Spanish - Spain", "interface": False, "audio": False, "subtitles": True},
    ]
