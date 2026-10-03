"""
The daily rotation the refresh jobs share: each game is visited on one fixed
day of a cycle, so a daily run touches 1/cycle of the catalogue.

A game's slice is crc32(appid) % cycle, NOT appid % cycle: Steam appids are
overwhelmingly multiples of 10, so `% 30` would leave 27 of the 30 monthly
slices empty and pile the whole catalogue into the other three.
"""
import zlib
from datetime import date, datetime, timezone
from typing import Optional

from .data_store import extract_appid


def slice_of(appid: str, cycle: int) -> int:
    """The day of the cycle on which this game is refreshed. Stable forever:
    crc32 is fixed, so a game keeps its weekday and its day of the month."""
    return zlib.crc32(appid.encode("ascii")) % cycle


def day_number(today: Optional[date] = None) -> int:
    """Days since 1970-01-01, UTC. Consecutive runs walk through the slices."""
    today = today or datetime.now(timezone.utc).date()
    return (today - date(1970, 1, 1)).days


def due(game: dict, cycle: int, day: int) -> bool:
    appid = extract_appid(game.get("link", ""))
    return bool(appid) and slice_of(appid, cycle) == day % cycle
