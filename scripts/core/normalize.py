"""
How values are WRITTEN to data/: the representation rules save_main() enforces.

Every dataset write goes through save_main(), so these run over every record on
every write, after whatever a script did to it and before the human overrides
(release_date, name, developer, publisher, description and tags are not
MANUAL_FIELDS, so no override ever governs them; the notes rule only rewrites a
machine-written phrase). Three properties make that safe, and each rule keeps
all of them:

  - Idempotent. A second pass returns its input unchanged, so a run that
    changed nothing still writes byte-identical shards and index.json keeps
    its stamp (CLAUDE.md, "the client's whole cache contract").
  - Lossless where it cannot be sure. A date it cannot read, a character it has
    no rule for, is kept exactly as it was.
  - Never news. Fixing how a value is written does not bump last_updated, for
    the reason truncate_descriptions() gives: it would show hundreds of games
    as freshly updated on the Activity and Health pages.

refresh_store_data.py applies the same rules to what Steam returns before it
compares, so a value is always compared as it will be stored.
"""
import html
import re
import unicodedata
from datetime import date

# ──────────── release_date ────────────

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# One canonical shape, "Aug 21, 2012": what appdetails returns to a US client,
# what 4,829 of 6,189 records already held on 2026-10-10, and what Date.parse()
# reads in every engine the site and the released apps run on. Steam's order is
# not stable - the same client was answered "30 Jan, 2023" and "Apr 28, 2025"
# minutes apart - and a request without l= once came back in Russian, so the
# shape is decided here rather than trusted from the response.
#
# Month names as Steam writes them per store language (appdetails?l=<language>,
# measured 2026-10-10: vietnamese "28 Thg04, 2025", russian "28 апр. 2025 г.",
# german "28. Apr. 2025", french "28 avr. 2025" / "25 sept. 2026", spanish
# "28 ABR 2025", brazilian "28/abr./2025", polish "28 kwietnia 2025", turkish
# "28 Nis 2025", italian "25 set 2026", ukrainian "25 верес. 2026"), keyed by
# the first four letters and then the first three. Four letters are needed only
# for French "juin"/"juil"; no prefix means different months in two languages.
_MONTH_PREFIXES: dict[str, int] = {
    # English (full names reduce to the same three letters; "Sept" too)
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    # German
    "mär": 3, "mai": 5, "okt": 10, "dez": 12,
    # French
    "fév": 2, "avr": 4, "juin": 6, "juil": 7, "aoû": 8, "déc": 12,
    # Spanish, Portuguese, Italian
    "ene": 1, "abr": 4, "ago": 8, "dic": 12,
    "fev": 2, "set": 9, "out": 10,
    "gen": 1, "mag": 5, "giu": 6, "lug": 7, "ott": 10,
    # Polish (Steam writes the genitive: "kwietnia")
    "sty": 1, "lut": 2, "kwi": 4, "maj": 5, "cze": 6, "lip": 7,
    "sie": 8, "wrz": 9, "paź": 10, "lis": 11, "gru": 12,
    # Turkish
    "oca": 1, "şub": 2, "nis": 4, "haz": 6, "tem": 7, "ağu": 8,
    "eyl": 9, "eki": 10, "kas": 11, "ara": 12,
    # Russian
    "янв": 1, "фев": 2, "мар": 3, "апр": 4, "мая": 5, "май": 5,
    "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
    # Ukrainian
    "січ": 1, "лют": 2, "бер": 3, "кві": 4, "тра": 5, "чер": 6,
    "лип": 7, "сер": 8, "вер": 9, "жов": 10, "лис": 11, "гру": 12,
}

_LETTERS = r"[^\W\d_]+"
# "Aug 21, 2012", "August 21 2012", "Sept. 3, 2025"
_RE_MONTH_FIRST = re.compile(rf"({_LETTERS})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})")
# "21 Aug, 2012", "28. Apr. 2025", "28/abr./2025", "28 апр. 2025 г.", "25 верес. 2026"
_RE_DAY_FIRST = re.compile(rf"(\d{{1,2}})[.\s/]+({_LETTERS})[.\s/,]+(\d{{4}})(?:\s*[гр]\.?)?")
# Vietnamese: "28 Thg04, 2025", "28 tháng 4, 2025"
_RE_VIETNAMESE = re.compile(r"(\d{1,2})\s+(?:thg|tháng)\s*(\d{1,2}),?\s+(\d{4})", re.IGNORECASE)
_RE_ISO = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
# Chinese and Japanese "2025 年 4 月 28 日", Korean "2025년 4월 28일"
_RE_CJK = re.compile(r"(\d{4})\s*[年년]\s*(\d{1,2})\s*[月월]\s*(\d{1,2})\s*[日일]")


def _month(word: str) -> int:
    w = word.lower()
    return _MONTH_PREFIXES.get(w[:4]) or _MONTH_PREFIXES.get(w[:3]) or 0


def _canonical(year: str, month: int, day: str):
    """'Mon D, YYYY', or None for a date that does not exist (Feb 30)."""
    try:
        d = date(int(year), month, int(day))
    except ValueError:
        return None
    return f"{MONTHS[d.month - 1]} {d.day}, {d.year}"


def normalize_release_date(value):
    """A full release date in any shape Steam writes it, as "Aug 21, 2012".

    Anything that is not a full calendar date - "Coming soon", "Q1 2026",
    "2026", "Aug 2026", an empty string, a day that does not exist - is
    returned unchanged: there is nothing to normalise it to, and a placeholder
    still tells the reader something.
    """
    if not isinstance(value, str):
        return value
    text = " ".join(unicodedata.normalize("NFC", value).split())
    out = None
    m = _RE_MONTH_FIRST.fullmatch(text)
    if m and _month(m.group(1)):
        out = _canonical(m.group(3), _month(m.group(1)), m.group(2))
    if out is None:
        m = _RE_DAY_FIRST.fullmatch(text)
        if m and _month(m.group(2)):
            out = _canonical(m.group(3), _month(m.group(2)), m.group(1))
    if out is None:
        m = _RE_VIETNAMESE.fullmatch(text)
        if m:
            out = _canonical(m.group(3), int(m.group(2)), m.group(1))
    if out is None:
        m = _RE_ISO.fullmatch(text) or _RE_CJK.fullmatch(text)
        if m:
            out = _canonical(m.group(1), int(m.group(2)), m.group(3))
    return out or value


# ──────────── Text ────────────

# Never content in a name or a blurb: zero-width space, BOM / zero-width
# no-break space, word joiner, and the bidi embedding, override and isolate
# controls. "Gameforge 4D GmbH" was stored with a stray U+202C after it, and
# "Triple Fantasy" with a ZWSP in front.
_INVISIBLE = dict.fromkeys(map(ord, (
    "​﻿⁠"
    "‪‫‬‭‮"
    "⁦⁧⁨⁩"
)))
# Two or more zero-width characters in a row are a watermark, not writing: one
# developer name carried 43 of them between "YAMAYURI " and "GAMES". A SINGLE
# zero-width joiner is how emoji sequences are built, and a single zero-width
# non-joiner is spelling in Persian and the Indic scripts, so those stay.
_ZERO_WIDTH_RUN = re.compile("[​‌‍]{2,}")
# Plain whitespace, tabs and NBSP ("Cagliari 1943\xa0VR", "ARTFX - GAME\t"), but
# not the ideographic space: "鳥獣妖怪戯画　(Choju Yokai Giga)" spells it that way.
_WHITESPACE = re.compile("[ \t\r\n\f\v ]+")


def clean_text(value, single_line: bool = True):
    """Strip invisible characters and the whitespace around a value.

    single_line (names, developers, publishers) also turns every run of
    whitespace into one plain space. Blurbs keep their line breaks.
    """
    if not isinstance(value, str):
        return value
    text = _ZERO_WIDTH_RUN.sub("", value).translate(_INVISIBLE)
    if single_line:
        text = _WHITESPACE.sub(" ", text)
    return text.strip()


def clean_list(values):
    """clean_text() over a list of names, dropping entries left empty (a
    publisher stored as [" "] is no publisher)."""
    if not isinstance(values, list):
        return values
    out = []
    for v in values:
        if isinstance(v, str):
            v = clean_text(v)
            if not v:
                continue
        out.append(v)
    return out


# A character reference WITH its semicolon. html.unescape() alone would also
# decode the legacy forms that have none, turning "this&not that" into
# "this¬ that"; Steam always writes the semicolon.
_ENTITY = re.compile(r"&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]{1,31});")


def decode_entities(value):
    """Text that reached us still HTML-escaped, as text.

    appdetails returns short_description escaped (`art &quot;game&quot;`) and
    the old tag scraper kept `Point &amp; Click` - next to a `Point & Click` the
    extension sent, so the tag filter listed both. The site renders these
    fields as text, so a reader saw the entity.
    """
    if not isinstance(value, str) or "&" not in value:
        return value
    return _ENTITY.sub(lambda m: html.unescape(m.group(0)), value)


def decode_tags(tags):
    """decode_entities() over a tag list, keeping the first of any two tags that
    become the same (case-insensitively, as scraper.parse_tags() dedupes)."""
    if not isinstance(tags, list):
        return tags
    out, seen = [], set()
    for t in tags:
        if isinstance(t, str):
            t = decode_entities(t)
            if t.lower() in seen:
                continue
            seen.add(t.lower())
        out.append(t)
    return out


# ──────────── notes ────────────

# The browser extension (poli0981/steam-f2p-extension) records "this game has
# paid DLC" as Vietnamese text in `notes`. The catalogue is English - nine
# records already said "Has paid DLC" - and has_paid_dlc carries the fact.
_NOTE_TRANSLATIONS = (
    ("Có DLC trả phí", "Has paid DLC"),
)


def translate_notes(value):
    """notes with the extension's Vietnamese phrases in English; the rest of the
    note ("; Easy Anti-Cheat [Kernel]", "💀 Dead game ...") stays as it is."""
    if not isinstance(value, str):
        return value
    nfc = unicodedata.normalize("NFC", value)
    out = nfc
    for vi, en in _NOTE_TRANSLATIONS:
        out = out.replace(vi, en)
    return out if out != nfc else value


# ──────────── Records ────────────

def _set(game: dict, field: str, value) -> bool:
    if game[field] != value:
        game[field] = value
        return True
    return False


def normalize_record(game: dict) -> list[str]:
    """Apply every rule to one record, in place. Returns the rules that changed it.

    Only fields the record already has are touched: a key is never added.
    """
    hit = []
    entities = text = False
    if "description" in game:
        entities |= _set(game, "description", decode_entities(game["description"]))
        text |= _set(game, "description", clean_text(game["description"], single_line=False))
    if "tags" in game:
        entities |= _set(game, "tags", decode_tags(game["tags"]))
    if "name" in game:
        text |= _set(game, "name", clean_text(game["name"]))
    for field in ("developer", "publisher"):
        if field in game:
            text |= _set(game, field, clean_list(game[field]))
    if entities:
        hit.append("entities")
    if text:
        hit.append("text")
    if "release_date" in game and _set(game, "release_date", normalize_release_date(game["release_date"])):
        hit.append("release_date")
    if "notes" in game and _set(game, "notes", translate_notes(game["notes"])):
        hit.append("notes")
    return hit


def normalize_records(records: list[dict]) -> dict[str, int]:
    """normalize_record() over every record. Returns {rule: records it changed},
    only the rules that changed something. Never touches last_updated."""
    counts: dict[str, int] = {}
    for game in records:
        for rule in normalize_record(game):
            counts[rule] = counts.get(rule, 0) + 1
    return counts
