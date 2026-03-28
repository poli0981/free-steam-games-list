"""
Store page HTML scraper v2.1.

Pre-compiled regexes for hot paths.
All parsers operate on the same HTML string (fetched once).
"""
import re

# ──── Pre-compiled patterns ────

_RE_LANG_TABLE = re.compile(
    r'<table\s+class\s*=\s*"game_language_options"[^>]*>(.*?)</table>',
    re.DOTALL | re.IGNORECASE,
)
_RE_TABLE_ROW = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL | re.IGNORECASE)
_RE_TABLE_CELL = re.compile(r'<td[^>]*>(.*?)</td>', re.DOTALL | re.IGNORECASE)
_RE_HAS_CHECK = re.compile(r'<span[^>]*>[^<]*</span>')
_RE_STRIP_HTML = re.compile(r'<[^>]+>')

_RE_DLC_SECTION = re.compile(
    r'(?:id\s*=\s*"gameAreaDLCSection"|class\s*=\s*"game_area_dlc_section")'
    r'(.*?)(?=<div\s+(?:class|id)\s*=\s*"(?!game_area_dlc)|$)',
    re.DOTALL | re.IGNORECASE,
)
_RE_DLC_PRICE_ATTR = re.compile(r'data-price-final\s*=\s*"(\d+)"')
_RE_DLC_PRICE_TEXT = re.compile(
    r'class\s*=\s*"game_area_dlc_price"[^>]*>(.*?)</div>',
    re.DOTALL | re.IGNORECASE,
)
_RE_HAS_DIGIT = re.compile(r'\d')

_RE_APP_TAG = re.compile(r'class\s*=\s*"app_tag"[^>]*>\s*([^<]+?)\s*</a>')


# ──── Language table ────

def parse_language_table(html: str) -> dict:
    """
    Parse #languageTable → {languages: [...], language_details: [...]}.
    Each detail has name, interface, audio, subtitles booleans.
    """
    m = _RE_LANG_TABLE.search(html)
    if not m:
        return {"languages": [], "language_details": []}

    table_html = m.group(1)
    languages, details = [], []

    for row_match in _RE_TABLE_ROW.finditer(table_html):
        row = row_match.group(1)
        if '<th' in row:
            continue

        cells = _RE_TABLE_CELL.findall(row)
        if len(cells) < 2:
            continue

        name = _RE_STRIP_HTML.sub('', cells[0]).strip()
        if not name:
            continue

        interface = bool(_RE_HAS_CHECK.search(cells[1])) if len(cells) > 1 else False
        audio     = bool(_RE_HAS_CHECK.search(cells[2])) if len(cells) > 2 else False
        subtitles = bool(_RE_HAS_CHECK.search(cells[3])) if len(cells) > 3 else False

        languages.append(name)
        details.append({
            "name": name,
            "interface": interface,
            "audio": audio,
            "subtitles": subtitles,
        })

    return {"languages": languages, "language_details": details}


# ──── DLC pricing ────

def parse_has_paid_dlc(html: str) -> bool:
    """Check if any DLC has a non-zero price via data-price-final or text."""
    m = _RE_DLC_SECTION.search(html)
    if not m:
        return False

    dlc_html = m.group(1)

    # Fast path: check data-price-final attributes
    for price_match in _RE_DLC_PRICE_ATTR.finditer(dlc_html):
        if int(price_match.group(1)) > 0:
            return True

    # Fallback: check price text
    for text_match in _RE_DLC_PRICE_TEXT.finditer(dlc_html):
        text = _RE_STRIP_HTML.sub('', text_match.group(1)).strip().lower()
        if text in ("", "free", "n/a", "free to play"):
            continue
        if _RE_HAS_DIGIT.search(text):
            return True

    return False


# ──── Tags ────

def parse_tags(html: str) -> list[str]:
    """Extract user-defined tags. Deduplicated, order preserved."""
    tags, seen = [], set()
    for m in _RE_APP_TAG.finditer(html):
        t = m.group(1).strip()
        key = t.lower()
        if t and t != "+" and key not in seen:
            tags.append(t)
            seen.add(key)
    return tags


# ──── Combined ────

def scrape_store_page(html: str) -> dict:
    """Parse languages + DLC pricing + tags from one HTML string."""
    lang = parse_language_table(html)
    return {
        "languages": lang["languages"],
        "language_details": lang["language_details"],
        "has_paid_dlc": parse_has_paid_dlc(html),
        "tags": parse_tags(html),
    }
