"""
SteamCharts (steamcharts.com): the only public record of a game's all-time
peak that goes back further than this project's own sampling. SteamDB has the
same numbers and forbids scraping; Valve's APIs only know today.

It has no API, no terms of use and no robots.txt (a 404 when checked on
2026-10-03), and it is served through Cloudflare. So this reads one page per
game, at most once a month per game (refresh_peaks.py), 2-3 seconds apart,
with a User-Agent that names the project, and gives up for the day at the
first sign of being unwelcome: a 403, a 429 or a Cloudflare challenge page.

What its pages answer, as measured on 2026-10-03:
  200 with an "all-time peak" stat   the number
  500                                an app it does not track - most of the
                                     long tail, games that never had a crowd
  404                                an appid it has never seen (new games)
"""
import random
import re
import time
from dataclasses import dataclass
from typing import Callable, Optional

import requests

URL = "https://steamcharts.com/app/{appid}"
USER_AGENT = "SteamF2PTracker/2.2 (+https://github.com/poli0981/free-steam-games-list)"
DELAY_MIN = 2.0
DELAY_MAX = 3.0

_PEAK = re.compile(
    r'<span class="num">\s*([0-9][0-9,]*)\s*</span>\s*<br\s*/?>\s*all-time peak',
    re.IGNORECASE,
)
# What Cloudflare serves instead of the page when it wants a browser.
_CHALLENGE_MARKERS = ("cf-chl", "challenge-platform", "<title>Just a moment...</title>")


def parse_all_time_peak(html: str) -> Optional[int]:
    """The "all-time peak" stat of an app page, or None if the page has none."""
    m = _PEAK.search(html or "")
    return int(m.group(1).replace(",", "")) if m else None


@dataclass(frozen=True)
class Result:
    """status: "ok" (peak set), "untracked" (500/404: SteamCharts has no data),
    "blocked" (403/429/challenge: stop for the day) or "error" (network trouble,
    another status, or a 200 page without the stat - a changed layout)."""
    status: str
    peak: Optional[int] = None


class SteamChartsClient:
    def __init__(
        self,
        session: Optional[requests.Session] = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._session = session or requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en"})
        self._sleep = sleep
        self._clock = clock
        self._last: Optional[float] = None

    def _throttle(self) -> None:
        if self._last is not None:
            wait = random.uniform(DELAY_MIN, DELAY_MAX) - (self._clock() - self._last)
            if wait > 0:
                self._sleep(wait)
        self._last = self._clock()

    def fetch(self, appid: str) -> Result:
        self._throttle()
        try:
            resp = self._session.get(URL.format(appid=appid), timeout=20)
        except requests.RequestException:
            return Result("error")
        code = resp.status_code
        if code in (403, 429):
            return Result("blocked")
        if code in (404, 500):
            return Result("untracked")
        if code != 200:
            return Result("error")
        text = resp.text
        peak = parse_all_time_peak(text)
        if peak is not None:
            return Result("ok", peak)
        # Only a page WITHOUT the stat can be a challenge: Cloudflare may also
        # inject its challenge-platform script into ordinary pages.
        if any(marker in text for marker in _CHALLENGE_MARKERS):
            return Result("blocked")
        return Result("error")
