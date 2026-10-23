"""
The daily rotation the refresh jobs share: each game is visited on one fixed
day of a cycle, so a daily run touches 1/cycle of the catalogue.

A game's slice is crc32(appid) % cycle, NOT appid % cycle: Steam appids are
overwhelmingly multiples of 10, so `% 30` would leave 27 of the 30 monthly
slices empty and pile the whole catalogue into the other three.

The cycle grows with the catalogue (cycle_for), so a daily run stays the same
size however many games there are; and a run visits its games in an order
that changes daily (daily_order), so one that stops at its time budget
(core/budget.py) leaves a different tail each day.
"""
import math
import zlib
from datetime import date, datetime, timezone
from typing import Optional

from .data_store import extract_appid


def cycle_for(count: int, base: int, daily: int) -> int:
    """The length of a rotation over `count` games: `base` days while a daily
    slice stays within `daily` games, then the smallest MULTIPLE of `base`
    that keeps it there.

    A multiple, because crc32 % (k * base) leaves crc32 % base unchanged: a
    game stays on the same day of the base cycle, so when the cycle grows its
    visits only thin out - never two within `base` days. SteamCharts keeps its
    one page per game a month, and the store page its weekday.
    """
    if count <= 0 or daily <= 0:
        return base
    return base * max(1, math.ceil(count / (base * daily)))


def daily_order(games: list[dict], day: int) -> list[dict]:
    """The games in an order that is fixed within a day and changes the next."""
    return sorted(games, key=lambda g: zlib.crc32(f"{day}:{extract_appid(g.get('link', ''))}".encode()))


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
