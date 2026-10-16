"""
A game's anti-cheat as its developer declares it on Steam.

Steam asks a developer to say which anti-cheat a game uses and whether it runs
in the kernel, and shows the answer in two places (measured 2026-10-16):

  GetItems   IStoreBrowseService/GetItems with data_request.include_extra_details:
             extra_details.anticheat = {kernel_mode, uninstall_completely,
             boot_protection, boot_protection_name, name, name_loc}. False
             booleans are left out, so {} is an anti-cheat outside the kernel;
             no `anticheat` at all is no disclosure. Steam's own list of
             products comes with a `name` (Delta Force: "Anti-Cheat Expert
             (ACE)"); a developer's own wording mostly does not (PUBG: only
             kernel_mode). It answers for the 'Adult Only' games whose store
             page needs a login.
  The page   one div.anticheat_section in the Features block:
               <div class="anticheat_section DRM_notice" >
                 <div>Uses Kernel Level Anti-Cheat</div>
                 <div class="anticheat_name">Easy Anti-Cheat<span class="anticheat_uninstalls"> - Requires manual removal after game uninstall</span></div>
               </div>
             The HEADING says whether it is kernel level ("Uses Kernel Level
             Anti-Cheat" / "Uses Anti-Cheat Software"), never the class:
             DRM_notice also marks an anti-cheat outside the kernel that needs
             Secure Boot. A "Boot Protection" row is that requirement, not a
             product. Names can be empty, free text, or end in a space.

No disclosure does not mean no anti-cheat - Warframe, Overwatch 2 and NARAKA
declare none - so nothing here ever clears a stored value.

apply_anti_cheat() is the one rule every writer uses: fetch_full() fills an
empty game, refresh_anticheat.py also replaces a value Steam contradicts, and
an override (core/overrides.py) beats both.
"""
import re
from dataclasses import dataclass
from html import unescape
from typing import Optional

from .constants import ANTI_CHEAT_PATTERNS
from .data_store import ELLIPSIS, extract_appid, is_empty
from .normalize import clean_text

FIELDS = ("anti_cheat", "anti_cheat_note", "is_kernel_ac")


@dataclass(frozen=True)
class Disclosure:
    """What Steam says. `name` is "" when Steam does not name the product;
    `kernel` is None only for a page whose heading this module cannot read."""
    name: str = ""
    kernel: Optional[bool] = None
    boot_protection: bool = False


# ──────────── The store page ────────────

# The heading, then the name rows that follow it, each with its own </div>.
_RE_SECTION = re.compile(
    r'<div\s+class\s*=\s*"anticheat_section(?:\s[^"]*)?"[^>]*>\s*'
    r'<div>([^<]*)</div>'
    r'((?:\s*<div\s+class\s*=\s*"anticheat_name"[^>]*>.*?</div>)*)',
    re.DOTALL | re.IGNORECASE,
)
_RE_NAME_ROW = re.compile(
    r'<div\s+class\s*=\s*"anticheat_name"[^>]*>(.*?)</div>', re.DOTALL | re.IGNORECASE)
_RE_UNINSTALLS = re.compile(
    r'<span\s+class\s*=\s*"anticheat_uninstalls"[^>]*>.*?</span>', re.DOTALL | re.IGNORECASE)
_RE_TAG = re.compile(r"<[^>]+>")

_HEADINGS = {
    "uses kernel level anti-cheat": True,
    "uses anti-cheat software": False,
}
BOOT_PROTECTION = "boot protection"


def _text(html: str) -> str:
    return clean_text(unescape(_RE_TAG.sub("", html)))


def parse_page(html: Optional[str]) -> Optional[Disclosure]:
    """The disclosure on an English store page, or None when it has none."""
    m = _RE_SECTION.search(html or "")
    if not m:
        return None
    kernel = _HEADINGS.get(_text(m.group(1)).lower())
    name, boot = "", False
    for row in _RE_NAME_ROW.findall(m.group(2)):
        text = _text(_RE_UNINSTALLS.sub("", row))
        if text.lower() == BOOT_PROTECTION:
            boot = True
        elif text and not name:
            name = text
    return Disclosure(name=name, kernel=kernel, boot_protection=boot)


# ──────────── Steam's JSON ────────────

def from_store_item(item: Optional[dict]) -> Optional[Disclosure]:
    """The disclosure in one GetItems item, or None when it has none."""
    details = (item or {}).get("extra_details")
    ac = details.get("anticheat") if isinstance(details, dict) else None
    if not isinstance(ac, dict):
        return None
    name = ac.get("name")
    return Disclosure(
        name=clean_text(name) if isinstance(name, str) else "",
        kernel=bool(ac.get("kernel_mode")),
        boot_protection=bool(ac.get("boot_protection")),
    )


VAC = Disclosure(name="VAC (Valve Anti-Cheat)", kernel=False)


def from_categories(categories) -> Optional[Disclosure]:
    """VAC from appdetails' "Valve Anti-Cheat enabled" category (id 8), in any
    position. Named as Steam names VAC in a disclosure, so a game that later
    declares it ends with the same note. VAC never runs in the kernel."""
    for cat in categories or []:
        if not isinstance(cat, dict):
            continue
        desc = str(cat.get("description") or "").lower()
        if cat.get("id") == 8 or any(p in desc for p in ANTI_CHEAT_PATTERNS["VAC"]):
            return VAC
    return None


def combine(api: Optional[Disclosure], page: Optional[Disclosure]) -> Optional[Disclosure]:
    """GetItems decides whether there is a disclosure and whether it is kernel
    level; the page supplies the name GetItems leaves out."""
    if api is None:
        return page
    if page is None or api.name:
        return api
    return Disclosure(name=page.name, kernel=api.kernel,
                      boot_protection=api.boot_protection or page.boot_protection)


# ──────────── Labels ────────────

def _alnum(text: str) -> str:
    return "".join(ch for ch in str(text).casefold() if ch.isalnum())


_RE_ACRONYM = re.compile(r"\(([A-Za-z0-9]{2,6})\)")


def canonical(text: str) -> Optional[str]:
    """The ANTI_CHEAT_PATTERNS key a name belongs to: one of its patterns, or
    the key's own name ("EAC", "KSS"). None for anything else."""
    low = str(text).lower()
    flat = _alnum(text)
    for key, patterns in ANTI_CHEAT_PATTERNS.items():
        if flat == _alnum(key) or any(p in low for p in patterns):
            return key
    return None


# Longest label. A developer can type a whole paragraph where the product name
# goes ("Frontier uses SCUE4 as its anti-cheat, which comes pre-built ...", 300
# characters), and the label is a badge on every list; the note keeps it all.
LABEL_MAX = 40


def label(name: str) -> str:
    """The stored `anti_cheat` for a name Steam shows: the short key for a
    known product, else Steam's own name, cut on a word at LABEL_MAX."""
    key = canonical(name)
    if key:
        return key
    text = clean_text(name)
    if len(text) <= LABEL_MAX:
        return text
    cut = text[:LABEL_MAX - 1]
    if cut.rfind(" ") >= LABEL_MAX // 2:
        cut = cut[:cut.rfind(" ")]
    return cut.rstrip(" ,;:.-") + ELLIPSIS


def _aliases(text: str) -> set[str]:
    out = {_alnum(text)}
    out.update(m.lower() for m in _RE_ACRONYM.findall(str(text)))
    return out - {""}


def same_family(a: str, b: str) -> bool:
    """Whether two anti-cheat values name the same product: "Easy Anti-Cheat"
    and "EAC", "ACE" and "Anti-Cheat Expert (ACE)", "CrackProof®" and
    "CrackProof"."""
    if clean_text(str(a)).casefold() == clean_text(str(b)).casefold():
        return True
    ca, cb = canonical(a), canonical(b)
    if ca or cb:
        return ca == cb
    fa, fb = _alnum(a), _alnum(b)
    for text, short, full in ((a, fa, fb), (b, fb, fa)):
        # A label label() cut short, and the name it was cut from.
        if str(text).endswith(ELLIPSIS) and len(short) >= 12 and full.startswith(short):
            return True
    return bool(_aliases(a) & _aliases(b))


# ──────────── Notes ────────────

KERNEL, NON_KERNEL = "[Kernel]", "[Non-Kernel]"


def note_for(name: str, kernel: Optional[bool], boot_protection: bool = False) -> str:
    """The note the extension wrote and the 71 games before this module carry:
    "Easy Anti-Cheat [Kernel]", plus "; Boot Protection" when Steam says so."""
    note = name
    if kernel is not None:
        note = f"{name} {KERNEL if kernel else NON_KERNEL}"
    return f"{note}; Boot Protection" if boot_protection else note


def _with_suffix(note, kernel: bool) -> Optional[str]:
    """The note with its kernel suffix set to `kernel`, or None when the note
    carries no suffix (a sentence a person wrote is not ours to rewrite)."""
    if not isinstance(note, str):
        return None
    for suffix in (KERNEL, NON_KERNEL):
        idx = note.find(f" {suffix}")
        if idx >= 0:
            return note[:idx] + f" {KERNEL if kernel else NON_KERNEL}" + note[idx + 1 + len(suffix):]
    return None


# ──────────── The rule ────────────

def apply_anti_cheat(game: dict, found: Optional[Disclosure], replace: bool = False,
                     guard=None) -> list[str]:
    """Bring one record's anti_cheat, anti_cheat_note and is_kernel_ac in line
    with `found`, in place. Returns the fields whose value changed.

      - Nothing found, or found without a name: nothing changes.
      - No anti-cheat stored yet: all three are written.
      - The same product: an empty note is filled and the kernel flag follows
        Steam (only an empty one unless `replace`); a note that carries a
        "[Kernel]"/"[Non-Kernel]" suffix gets the new one, other notes stay.
      - Another product: all three are replaced, only when `replace`.
      - `guard` (overrides.OverrideGuard) refuses writes an override would
        undo. With the label locked to another product nothing is written; a
        locked kernel flag decides the suffix of a note written here.
    """
    if found is None or not found.name:
        return []
    appid = extract_appid(game.get("link", "")) or ""

    def allowed(field: str, value) -> bool:
        return guard is None or guard.allows(appid, field, value)

    changed: list[str] = []

    def put(field: str, value) -> None:
        if game.get(field) != value and allowed(field, value):
            game[field] = value
            changed.append(field)

    new_label = label(found.name)
    stored = game.get("anti_cheat")
    fresh = is_empty(stored)
    other = not fresh and not (same_family(stored, found.name) or same_family(stored, new_label))
    if other and not replace:
        return []
    if (fresh or other) and not allowed("anti_cheat", new_label):
        return []   # an override decided the product ("-" included)

    kernel_before = game.get("is_kernel_ac")
    if found.kernel is not None and (fresh or other or replace or kernel_before is None):
        put("is_kernel_ac", found.kernel)
    # The note's suffix says what is STORED: Steam's flag, or the one an
    # override locked (none at all for a locked null).
    kernel_now = game.get("is_kernel_ac")
    suffix = kernel_now if isinstance(kernel_now, bool) else None

    note = game.get("anti_cheat_note")
    if fresh or other:
        put("anti_cheat", new_label)
        if other or is_empty(note) or _with_suffix(note, True) is not None:
            put("anti_cheat_note", note_for(found.name, suffix, found.boot_protection))
    elif is_empty(note):
        put("anti_cheat_note", note_for(found.name, suffix, found.boot_protection))
    elif isinstance(suffix, bool):
        swapped = _with_suffix(note, suffix)
        if swapped is not None:
            put("anti_cheat_note", swapped)
    return changed
