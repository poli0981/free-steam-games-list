"""
Store page HTML scraper.

Extracts data NOT available via Steam appdetails API:
  - Language table (interface / audio / subtitles per language)
  - DLC pricing (are any DLCs actually paid?)
  - User-defined tags

All parsers take raw HTML string and return structured data.
Uses regex only (no BeautifulSoup dependency).

HTML structures are documented in scrape.html reference file.
"""
import re
from typing import Optional


# ──────────── Language table ────────────

def parse_language_table(html: str) -> dict:
    """
    Parse #languageTable from store page HTML.

    HTML structure:
        <table class="game_language_options">
          <tr><th/><th>Interface</th><th>Full Audio</th><th>Subtitles</th></tr>
          <tr>
            <td class="ellipsis"> English </td>
            <td class="checkcol"><span>✔</span></td>   ← interface
            <td class="checkcol"></td>                   ← no audio
            <td class="checkcol"><span>✔</span></td>   ← subtitles
          </tr>
          ...
        </table>

    Returns:
        {
            "languages": ["English", "Japanese", ...],
            "language_details": [
                {"name": "English", "interface": true, "audio": false, "subtitles": true},
                ...
            ]
        }
    """
    # Find the language table
    table_match = re.search(
        r'<table\s+class\s*=\s*"game_language_options"[^>]*>(.*?)</table>',
        html, re.DOTALL | re.IGNORECASE,
    )
    if not table_match:
        return {"languages": [], "language_details": []}

    table_html = table_match.group(1)

    # Find all rows (skip header row which has <th>)
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL | re.IGNORECASE)

    languages = []
    details = []

    for row in rows:
        # Skip header rows (contain <th>)
        if '<th' in row:
            continue

        # Extract cells
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
        if len(cells) < 2:
            continue

        # Cell 0: language name (inside <td class="ellipsis">)
        lang_name = re.sub(r'<[^>]+>', '', cells[0]).strip()
        if not lang_name:
            continue

        # Cells 1-3: interface, audio, subtitles
        # A checkmark is present if the cell contains <span>✔</span> or any <span> content
        def has_check(cell_html: str) -> bool:
            return bool(re.search(r'<span[^>]*>[^<]*</span>', cell_html))

        interface = has_check(cells[1]) if len(cells) > 1 else False
        audio     = has_check(cells[2]) if len(cells) > 2 else False
        subtitles = has_check(cells[3]) if len(cells) > 3 else False

        languages.append(lang_name)
        details.append({
            "name": lang_name,
            "interface": interface,
            "audio": audio,
            "subtitles": subtitles,
        })

    return {"languages": languages, "language_details": details}


# ──────────── DLC pricing ────────────

def parse_has_paid_dlc(html: str) -> bool:
    """
    Check if the game has PAID DLC by parsing the DLC section.

    Logic:
      1. Find #gameAreaDLCSection
      2. For each .game_area_dlc_row, check the price:
         - data-price-final="0" → free DLC
         - data-price-final="3500000" → paid DLC (value in cents)
         - Or parse text: "Free", "$0.00" → free; anything with digits → paid
      3. Return True only if at least one DLC has a non-zero price

    HTML structure (paid DLC):
        <div class="discount_block" data-price-final="3500000" ...>

    HTML structure (free DLC):
        <div class="game_area_dlc_price"> Free </div>
        or data-price-final="0"
    """
    # Find DLC section
    dlc_match = re.search(
        r'(?:id\s*=\s*"gameAreaDLCSection"|class\s*=\s*"game_area_dlc_section")(.*?)(?:</div>\s*</div>\s*</div>)',
        html, re.DOTALL | re.IGNORECASE,
    )
    if not dlc_match:
        return False

    dlc_html = dlc_match.group(1)

    # Method 1: Check data-price-final attributes
    prices = re.findall(r'data-price-final\s*=\s*"(\d+)"', dlc_html)
    for p in prices:
        if int(p) > 0:
            return True

    # Method 2: Check price text in DLC rows
    price_blocks = re.findall(
        r'class\s*=\s*"game_area_dlc_price"[^>]*>(.*?)</div>',
        dlc_html, re.DOTALL | re.IGNORECASE,
    )
    for block in price_blocks:
        text = re.sub(r'<[^>]+>', '', block).strip().lower()
        # Skip free indicators
        if text in ("", "free", "n/a", "free to play"):
            continue
        # If there are digits, it's a price
        if re.search(r'\d', text):
            return True

    # Method 3: Check "Add all DLC to Cart" purchase action price
    cart_price = re.search(
        r'id\s*=\s*"dlc_purchase_action".*?class\s*=\s*"game_purchase_price[^"]*"[^>]*>(.*?)</div>',
        dlc_html, re.DOTALL | re.IGNORECASE,
    )
    if cart_price:
        text = re.sub(r'<[^>]+>', '', cart_price.group(1)).strip().lower()
        if text not in ("", "free", "free to play") and re.search(r'\d', text):
            return True

    return False


# ──────────── Tags ────────────

def parse_tags(html: str) -> list[str]:
    """
    Extract user-defined tags from .popular_tags a.app_tag elements.
    Includes tags with display:none (Steam hides overflow tags).

    Returns: ["Action", "Puzzle", "2D", ...] (deduplicated, order preserved)
    """
    matches = re.findall(
        r'class\s*=\s*"app_tag"[^>]*>\s*([^<]+?)\s*</a>',
        html,
    )
    tags = []
    seen = set()
    for m in matches:
        t = m.strip()
        if t and t != "+" and t.lower() not in seen:
            tags.append(t)
            seen.add(t.lower())
    return tags


# ──────────── Combined scrape ────────────

def scrape_store_page(html: str) -> dict:
    """
    Parse all scrapeable data from a store page HTML in one pass.

    Returns:
        {
            "languages": [...],
            "language_details": [...],
            "has_paid_dlc": bool,
            "tags": [...],
        }
    """
    lang_data = parse_language_table(html)
    return {
        "languages": lang_data["languages"],
        "language_details": lang_data["language_details"],
        "has_paid_dlc": parse_has_paid_dlc(html),
        "tags": parse_tags(html),
    }
