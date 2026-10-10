"""
Rate-limited Steam HTTP client v2.2.
"""
import json
import random
import time
from typing import Optional
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .constants import (
    MAX_RETRIES, RETRY_BACKOFF, RETRY_429_WAIT,
    STORE_DELAY_MIN, STORE_DELAY_MAX,
    API_DELAY_MIN, API_DELAY_MAX,
)


def _jitter(lo: float, hi: float) -> float:
    return random.uniform(lo, hi)


# What Steam's age gate stores once a visitor has entered a birth date, and what
# "View Page" on a mature-content notice stores. They take an anonymous client
# past the gate of an M-rated game (Warframe, PUBG and Rainbow Six Siege were
# gated on the US runners). The gate of an 'Adult Only' game is a Sign In page
# that no cookie opens; core/store_items.py is how those games are read.
# Sent with store-page requests only, so the search that discovery reads is
# exactly what it was.
STORE_AGE_COOKIES = {
    "birthtime": "631152001",           # 1990-01-01
    "lastagecheckage": "1-January-1990",
    "wants_mature_content": "1",
    "mature_content": "1",
}

STORE_ITEMS_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
TAG_LIST_URL = "https://api.steampowered.com/IStoreService/GetTagList/v1/"
STORE_ITEMS_BATCH = 50


def store_page_status(appid: str, final_url: str, history_urls=()) -> str:
    """What a store-page request ended on: 'ok' (the game's own page),
    'age_gate', or 'not_store' (the store front for a delisted app, another app).

    requests follows redirects, so a gate used to come back as a 200 whose body
    was the gate. Measured 2026-10-10, an Adult Only game goes
    /app/<id>/ -> /agecheck/app/<id>/ -> /login/?redir=..., 200 at the end, so
    the whole chain is checked and not just where it stopped.
    """
    if any("/agecheck/" in urlparse(u).path for u in (*history_urls, final_url)):
        return "age_gate"
    url = urlparse(final_url)
    if url.path.startswith("/login"):
        return "age_gate"
    parts = [p for p in url.path.split("/") if p]
    if url.hostname == "store.steampowered.com" and parts[:2] == ["app", str(appid)]:
        return "ok"
    return "not_store"


class SteamClient:
    __slots__ = ("_session", "_last_store", "_last_api", "_tag_names")

    def __init__(self):
        self._session = self._build_session()
        self._last_store = 0.0
        self._last_api = 0.0
        self._tag_names: Optional[dict[int, str]] = None

    @staticmethod
    def _build_session() -> requests.Session:
        s = requests.Session()
        s.headers.update({
            "User-Agent": "SteamF2PTracker/2.2 (GitHub Actions)",
            "Accept-Language": "en",
        })
        adapter = HTTPAdapter(
            max_retries=Retry(total=2, backoff_factor=0.5,
                              status_forcelist=[], allowed_methods=["GET", "HEAD"]),
            pool_connections=10, pool_maxsize=10,
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        return s

    def _throttle_store(self):
        elapsed = time.monotonic() - self._last_store
        needed = _jitter(STORE_DELAY_MIN, STORE_DELAY_MAX)
        if elapsed < needed:
            time.sleep(needed - elapsed)
        self._last_store = time.monotonic()

    def _throttle_api(self):
        elapsed = time.monotonic() - self._last_api
        needed = _jitter(API_DELAY_MIN, API_DELAY_MAX)
        if elapsed < needed:
            time.sleep(needed - elapsed)
        self._last_api = time.monotonic()

    def _get(self, url, params=None, timeout=15, throttle_fn=None, cookies=None):
        if throttle_fn:
            throttle_fn()
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._session.get(url, params=params, timeout=timeout, cookies=cookies)
                code = resp.status_code
                if code == 200:
                    return resp
                if code == 429:
                    wait = int(resp.headers.get("Retry-After", RETRY_429_WAIT))
                    time.sleep(wait + _jitter(1, 5))
                    continue
                if code in (403, 401):
                    return None
                if code in (404, 410):
                    return resp  # Caller handles
                if code >= 500:
                    time.sleep(RETRY_BACKOFF ** attempt + _jitter(0, 2))
                    continue
                return None
            except requests.exceptions.Timeout:
                time.sleep(RETRY_BACKOFF ** attempt)
            except requests.exceptions.ConnectionError:
                time.sleep(RETRY_BACKOFF ** attempt + _jitter(0, 3))
            except Exception:
                return None
        return None

    # ──── Public API ────

    def fetch_app_details_full(self, appid: str) -> tuple[str, Optional[dict]]:
        """Returns (status, data). Status: 'ok'|'unavailable'|'not_found'|'network_error'.

        l=english is not optional. Without it the language is whatever Steam
        decides for the request, and on 2026-10-01 a runner was answered in
        Russian: Wuthering Waves' release date was stored as "28 апр. 2025 г.".
        """
        resp = self._get(
            "https://store.steampowered.com/api/appdetails",
            params={"appids": appid, "l": "english"},
            throttle_fn=self._throttle_store,
        )
        if not resp:
            return ("network_error", None)
        if resp.status_code in (404, 410):
            return ("not_found", None)
        try:
            entry = resp.json().get(str(appid), {})
            if entry.get("success"):
                return ("ok", entry["data"])
            return ("unavailable", None)
        except (ValueError, KeyError):
            return ("network_error", None)

    def fetch_app_details(self, appid: str) -> Optional[dict]:
        status, data = self.fetch_app_details_full(appid)
        return data if status == "ok" else None

    def fetch_reviews(self, appid: str) -> Optional[dict]:
        resp = self._get(
            f"https://store.steampowered.com/appreviews/{appid}",
            params={"json": "1", "language": "all", "purchase_type": "all"},
            throttle_fn=self._throttle_store,
        )
        if not resp:
            return None
        try:
            body = resp.json()
            return body.get("query_summary") if body.get("success") == 1 else None
        except (ValueError, KeyError):
            return None

    def fetch_player_count(self, appid: str, api_key: str) -> Optional[int]:
        resp = self._get(
            "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
            params={"key": api_key, "appid": appid},
            throttle_fn=self._throttle_api,
        )
        if not resp:
            return None
        try:
            return resp.json()["response"].get("player_count")
        except (ValueError, KeyError):
            return None

    def fetch_store_page_full(self, appid: str) -> tuple[str, Optional[str]]:
        """GET the store page. Returns (status, html), html only for 'ok'.

        Status: 'ok' | 'age_gate' | 'not_store' | 'not_found' | 'network_error'
        (see store_page_status). Only the game's own page is ever handed back:
        a gate has no language table, no tags and no DLC section, and read as a
        page it once set has_paid_dlc=False on every gated game.
        """
        resp = self._get(
            f"https://store.steampowered.com/app/{appid}/",
            params={"l": "english"},
            throttle_fn=self._throttle_store,
            timeout=20,
            cookies=STORE_AGE_COOKIES,
        )
        if not resp:
            return ("network_error", None)
        if resp.status_code in (404, 410):
            return ("not_found", None)
        if resp.status_code != 200:
            return ("network_error", None)
        status = store_page_status(appid, resp.url, [h.url for h in resp.history])
        return (status, resp.text if status == "ok" else None)

    def fetch_store_page(self, appid: str) -> Optional[str]:
        """GET full store page HTML. Single request for tags + languages + DLC prices.
        None for anything but the game's own page (an age gate included)."""
        _, html = self.fetch_store_page_full(appid)
        return html

    def fetch_store_items(self, appids) -> Optional[dict[str, dict]]:
        """IStoreBrowseService/GetItems: {appid: item} for the ids Steam knows.

        Keyless, and it answers for games whose store page needs a login. An id
        Steam does not know comes back as success 15 with appid 0, so items are
        keyed by the id that was asked for and kept only with success 1. None
        if any request failed, so a partial answer is never read as a whole one.
        """
        ids = [str(a) for a in appids if str(a).isdigit()]
        out: dict[str, dict] = {}
        for start in range(0, len(ids), STORE_ITEMS_BATCH):
            request = {
                "ids": [{"appid": int(a)} for a in ids[start:start + STORE_ITEMS_BATCH]],
                "context": {"language": "english", "country_code": "US", "steam_realm": 1},
                "data_request": {"include_tag_count": 20, "include_supported_languages": True},
            }
            resp = self._get(
                STORE_ITEMS_URL,
                params={"input_json": json.dumps(request)},
                throttle_fn=self._throttle_api,
            )
            if not resp or resp.status_code != 200:
                return None
            try:
                items = resp.json()["response"].get("store_items") or []
            except (ValueError, KeyError, AttributeError):
                return None
            for item in items:
                if isinstance(item, dict) and item.get("success") == 1 and item.get("id"):
                    out[str(item["id"])] = item
        return out

    def fetch_tag_names(self) -> dict[int, str]:
        """{tagid: English name} from IStoreService/GetTagList, fetched once per
        client. A failure is not cached, and returns {} (no tag is named)."""
        if self._tag_names is None:
            resp = self._get(TAG_LIST_URL, params={"language": "english"},
                             throttle_fn=self._throttle_api)
            if not resp or resp.status_code != 200:
                return {}
            try:
                tags = resp.json()["response"].get("tags") or []
                names = {int(t["tagid"]): t["name"] for t in tags if t.get("name")}
            except (ValueError, KeyError, TypeError, AttributeError):
                return {}
            if not names:
                return {}
            self._tag_names = names
        return self._tag_names

    def fetch_search_page(self, start: int, count: int = 100) -> Optional[dict]:
        """Store search: free games, newest first. Returns the parsed JSON
        ({'success', 'results_html', 'total_count', 'start'}) or None.

        This is the ONLY discovery-capable method on this client - every other
        one needs an appid you already have. It deliberately shares
        _throttle_store with fetch_app_details_full so search pages and
        appdetails calls draw on ONE rate budget rather than two.

        Measured: the server caps page size at 100 regardless of `count`, and a
        `start` past the end returns zero rows rather than an error, so a paging
        loop terminates naturally.
        """
        resp = self._get(
            "https://store.steampowered.com/search/results/",
            params={
                "query": "",
                "start": start,
                "count": count,
                "maxprice": "free",
                "category1": 998,      # "Games" - excludes DLC/soundtracks/videos/software
                "supportedlang": "english",
                "sort_by": "Released_DESC",
                "infinite": 1,
            },
            throttle_fn=self._throttle_store,
            timeout=20,
        )
        # _get hands back the response for 404/410, so an explicit status check
        # is required here - same as fetch_store_page above.
        if not resp or resp.status_code != 200:
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        return body if body.get("success") else None

    def check_store_page(self, appid: str) -> int:
        """HEAD request only – lightweight dead link check."""
        self._throttle_store()
        try:
            resp = self._session.head(
                f"https://store.steampowered.com/app/{appid}/",
                timeout=10, allow_redirects=True,
            )
            return resp.status_code
        except Exception:
            return -1

    def close(self):
        self._session.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


_default_client: Optional[SteamClient] = None

def get_client() -> SteamClient:
    global _default_client
    if _default_client is None:
        _default_client = SteamClient()
    return _default_client
