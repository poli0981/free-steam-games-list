"""
Rate-limited Steam HTTP client.
Unchanged from v2.0 – already handles backoff, retry, 429, session pooling.
"""
import random
import time
from typing import Optional

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


class SteamClient:
    def __init__(self):
        self._session = self._build_session()
        self._last_store = 0.0
        self._last_api = 0.0

    @staticmethod
    def _build_session() -> requests.Session:
        s = requests.Session()
        s.headers.update({
            "User-Agent": "SteamF2PTracker/2.1 (GitHub Actions)",
            "Accept-Language": "en",
            "Accept": "application/json",
        })
        adapter = HTTPAdapter(
            max_retries=Retry(total=2, backoff_factor=0.5,
                              status_forcelist=[], allowed_methods=["GET"]),
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

    def _get(self, url, params=None, timeout=15, throttle_fn=None):
        if throttle_fn:
            throttle_fn()
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._session.get(url, params=params, timeout=timeout)
                if resp.status_code == 200:
                    return resp
                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", RETRY_429_WAIT))
                    print(f"  ⚠ 429 – waiting {wait}s (attempt {attempt})")
                    time.sleep(wait + _jitter(1, 5))
                    continue
                if resp.status_code in (403, 401):
                    print(f"  ✗ {resp.status_code} auth error for {url}")
                    return None
                if resp.status_code in (404, 410):
                    return resp
                if resp.status_code >= 500:
                    wait = RETRY_BACKOFF ** attempt + _jitter(0, 2)
                    print(f"  ⚠ {resp.status_code} – retry in {wait:.1f}s")
                    time.sleep(wait)
                    continue
                print(f"  ✗ Unexpected {resp.status_code} for {url}")
                return None
            except requests.exceptions.Timeout:
                time.sleep(RETRY_BACKOFF ** attempt)
            except requests.exceptions.ConnectionError as e:
                time.sleep(RETRY_BACKOFF ** attempt + _jitter(0, 3))
            except Exception as e:
                print(f"  ✗ Unexpected error: {e}")
                return None
        print(f"  ✗ All {MAX_RETRIES} retries exhausted")
        return None

    # ──────────── Public API ────────────

    def fetch_app_details(self, appid: str) -> Optional[dict]:
        status, data = self.fetch_app_details_full(appid)
        return data if status == "ok" else None

    def fetch_app_details_full(self, appid: str) -> tuple[str, Optional[dict]]:
        resp = self._get(
            "https://store.steampowered.com/api/appdetails",
            params={"appids": appid},
            throttle_fn=self._throttle_store,
        )
        if not resp:
            return ("network_error", None)
        if resp.status_code in (404, 410):
            return ("not_found", None)
        try:
            body = resp.json()
            entry = body.get(str(appid), {})
            if entry.get("success"):
                return ("ok", entry["data"])
            return ("unavailable", None)
        except (ValueError, KeyError):
            return ("network_error", None)

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
            if body.get("success") == 1:
                return body.get("query_summary")
        except (ValueError, KeyError):
            pass
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

    def check_store_page(self, appid: str) -> int:
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

    def __exit__(self, *a):
        self.close()


_default_client: Optional[SteamClient] = None

def get_client() -> SteamClient:
    global _default_client
    if _default_client is None:
        _default_client = SteamClient()
    return _default_client
