"""
Rate-limited Steam HTTP client.

Features:
  - Exponential backoff with jitter on transient errors (429, 5xx)
  - Respects Retry-After header
  - Separate rate buckets for Store API vs Web API (keyed)
  - Session reuse (connection pooling)
  - Structured logging
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

# ──────────── Helpers ────────────

def _jitter(base_min: float, base_max: float) -> float:
    return random.uniform(base_min, base_max)


class SteamClient:
    """Thread-unsafe HTTP client for sequential Steam API access."""

    def __init__(self):
        self._session = self._build_session()
        self._last_store_call = 0.0
        self._last_api_call = 0.0

    # ── Session with connection pooling & low-level retry ──
    @staticmethod
    def _build_session() -> requests.Session:
        s = requests.Session()
        s.headers.update({
            "User-Agent": "SteamF2PTracker/2.0 (GitHub Actions; +https://github.com)",
            "Accept-Language": "en",
            "Accept": "application/json",
        })
        # Only retry on connection-level errors, NOT on status codes
        # (we handle 429/5xx ourselves with smarter backoff)
        adapter = HTTPAdapter(
            max_retries=Retry(total=2, backoff_factor=0.5,
                              status_forcelist=[], allowed_methods=["GET"]),
            pool_connections=10,
            pool_maxsize=10,
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        return s

    # ── Rate-limit sleeps ──
    def _throttle_store(self):
        elapsed = time.monotonic() - self._last_store_call
        needed = _jitter(STORE_DELAY_MIN, STORE_DELAY_MAX)
        if elapsed < needed:
            time.sleep(needed - elapsed)
        self._last_store_call = time.monotonic()

    def _throttle_api(self):
        elapsed = time.monotonic() - self._last_api_call
        needed = _jitter(API_DELAY_MIN, API_DELAY_MAX)
        if elapsed < needed:
            time.sleep(needed - elapsed)
        self._last_api_call = time.monotonic()

    # ── Core GET with retry ──
    def _get(self, url: str, params: Optional[dict] = None,
             timeout: int = 15, throttle_fn=None) -> Optional[requests.Response]:
        """
        GET with exponential backoff on 429 / 5xx.
        Returns Response or None on permanent failure.
        """
        if throttle_fn:
            throttle_fn()

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._session.get(url, params=params, timeout=timeout)

                if resp.status_code == 200:
                    return resp

                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", RETRY_429_WAIT))
                    print(f"  ⚠ 429 rate-limited – waiting {wait}s (attempt {attempt})")
                    time.sleep(wait + _jitter(1, 5))
                    continue

                if resp.status_code in (403, 401):
                    print(f"  ✗ {resp.status_code} forbidden/auth error for {url}")
                    return None  # Permanent, don't retry

                if resp.status_code in (404, 410):
                    return resp  # Caller handles dead links

                if resp.status_code >= 500:
                    wait = RETRY_BACKOFF ** attempt + _jitter(0, 2)
                    print(f"  ⚠ {resp.status_code} server error – retry in {wait:.1f}s")
                    time.sleep(wait)
                    continue

                # Other 4xx – don't retry
                print(f"  ✗ Unexpected {resp.status_code} for {url}")
                return None

            except requests.exceptions.Timeout:
                wait = RETRY_BACKOFF ** attempt
                print(f"  ⚠ Timeout (attempt {attempt}) – retry in {wait:.1f}s")
                time.sleep(wait)
            except requests.exceptions.ConnectionError as e:
                wait = RETRY_BACKOFF ** attempt + _jitter(0, 3)
                print(f"  ⚠ Connection error (attempt {attempt}): {e} – retry in {wait:.1f}s")
                time.sleep(wait)
            except Exception as e:
                print(f"  ✗ Unexpected error: {e}")
                return None

        print(f"  ✗ All {MAX_RETRIES} retries exhausted for {url}")
        return None

    # ──────────── Public API ────────────

    def fetch_app_details(self, appid: str) -> Optional[dict]:
        """Fetch store details for a single appid. Returns data dict or None."""
        status, data = self.fetch_app_details_full(appid)
        return data if status == "ok" else None

    def fetch_app_details_full(self, appid: str) -> tuple[str, Optional[dict]]:
        """
        Fetch store details with full status reporting.

        Returns (status, data) where status is one of:
          - "ok"           : success, data dict returned
          - "unavailable"  : Steam says success=false (delisted / removed / region-locked)
          - "not_found"    : HTTP 404 or 410
          - "network_error": timeout / connection issue / unexpected failure
        """
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
            else:
                # Steam explicitly returned success: false
                return ("unavailable", None)
        except (ValueError, KeyError):
            return ("network_error", None)

    def fetch_reviews(self, appid: str) -> Optional[dict]:
        """Fetch review summary. Returns query_summary dict or None."""
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
        """Fetch current player count (requires API key). Returns int or None."""
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
        """
        HEAD request to store page – returns HTTP status code.
        Used for dead link detection.
        """
        self._throttle_store()
        url = f"https://store.steampowered.com/app/{appid}/"
        try:
            resp = self._session.head(url, timeout=10, allow_redirects=True)
            return resp.status_code
        except Exception:
            return -1  # Network error

    def close(self):
        self._session.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# Module-level singleton for simple scripts
_default_client: Optional[SteamClient] = None

def get_client() -> SteamClient:
    global _default_client
    if _default_client is None:
        _default_client = SteamClient()
    return _default_client
