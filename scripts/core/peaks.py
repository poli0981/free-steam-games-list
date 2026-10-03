"""
all_time_peak: the most players a game has had at once, as far as anyone
recorded.

Two sources raise it, and nothing ever lowers it:
  - SteamCharts' recorded all-time peak (refresh_peaks.py). It goes back to
    when SteamCharts started tracking the game, which for anything that ever
    had a crowd is its launch.
  - Our own Steam Web API samples: apply_players() raises it whenever a sample
    beats it, and peak_today - the highest sample since the last refetch, never
    reset daily despite its name - is a floor too.

A formatted string like current_players ("1,818,368"); "N/A" until either
source has a number. refetch_all.py must never clear it: unlike the other
player fields it cannot be fetched again.
"""
from typing import Optional

FIELD = "all_time_peak"


def parse_count(value) -> Optional[int]:
    """A stored player count ("1,818,368", 1818368) as an int; None for "N/A",
    "Error", "" and anything else that is not a count."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if not isinstance(value, str):
        return None
    digits = value.replace(",", "").strip()
    return int(digits) if digits.isdigit() else None


def format_count(count: int) -> str:
    return f"{count:,}"


def raise_peak(game: dict, count: Optional[int]) -> bool:
    """Set all_time_peak to `count` if that is higher than what is stored.
    Returns True when it changed. A count of 0 is accepted here (SteamCharts
    does record games whose peak was 0); callers holding only our own samples
    skip 0, which says nothing about a peak."""
    if count is None or count < 0:
        return False
    stored = parse_count(game.get(FIELD))
    if stored is not None and count <= stored:
        return False
    game[FIELD] = format_count(count)
    return True


def observed_peak(game: dict) -> Optional[int]:
    """The highest count our own samples recorded for this game, or None when
    they never saw a single player."""
    samples = (parse_count(game.get("peak_today")), parse_count(game.get("current_players")))
    return max((s for s in samples if s), default=None)
