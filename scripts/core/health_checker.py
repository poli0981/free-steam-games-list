"""
Health checker – single source of truth for game status detection.

Diagnoses a game's health by checking:
  1. Link format validity
  2. Steam store availability (appdetails API → success: true/false)
  3. Store page HTTP status (404, 410)
  4. Free-to-play status (is_free flag + price_overview)

Used by:
  - purge_unhealthy.py  (scan existing games → remove + log)
  - ingest_new.py       (pre-flight check on new links → reject before adding)
"""
from dataclasses import dataclass
from typing import Optional

from .data_store import extract_appid
from .steam_client import SteamClient, get_client


# ──────────── Status codes ────────────
# Healthy
OK                = "ok"
# Unhealthy – game should be removed / rejected
INVALID_FORMAT    = "invalid_format"      # link cannot be parsed to an appid
NOT_FOUND_404     = "not_found_404"       # HTTP 404 on store page
NOT_FOUND_410     = "not_found_410"       # HTTP 410 Gone
UNAVAILABLE       = "unavailable"         # appdetails success: false (delisted, region-locked, etc.)
NOT_FREE          = "not_free"            # game exists but is no longer F2P
# Transient – do NOT remove, just skip
NETWORK_ERROR     = "network_error"       # timeout / connection failure

# Set of statuses that mean "remove from list"
REMOVABLE_STATUSES = {INVALID_FORMAT, NOT_FOUND_404, NOT_FOUND_410, UNAVAILABLE, NOT_FREE}

# Human-readable labels
REASON_LABELS = {
    INVALID_FORMAT:  "Invalid link format",
    NOT_FOUND_404:   "Store page 404 – game not found",
    NOT_FOUND_410:   "Store page 410 – permanently removed",
    UNAVAILABLE:     "No longer available on Steam (delisted)",
    NOT_FREE:        "No longer free-to-play",
    NETWORK_ERROR:   "Network error (skipped, not removed)",
    OK:              "Healthy",
}


@dataclass
class HealthResult:
    """Result of a single game health check."""
    status: str
    appid: Optional[str]
    name: str
    link: str

    @property
    def is_healthy(self) -> bool:
        return self.status == OK

    @property
    def should_remove(self) -> bool:
        return self.status in REMOVABLE_STATUSES

    @property
    def reason(self) -> str:
        return REASON_LABELS.get(self.status, f"Unknown ({self.status})")


# ──────────── Core check function ────────────

def check_game_health(
    link: str,
    name: str = "",
    client: Optional[SteamClient] = None,
) -> HealthResult:
    """
    Full health check for a single game link.

    Order of checks (short-circuits on first failure):
      1. Parse appid from link
      2. Fetch appdetails → unavailable / not_free
      3. HEAD store page  → 404 / 410

    Returns HealthResult with status, appid, name, link.
    """
    c = client or get_client()

    # 1) Link format
    appid = extract_appid(link)
    if not appid:
        return HealthResult(INVALID_FORMAT, None, name, link)

    # 2) App details API (most informative – tells us availability + price)
    api_status, data = c.fetch_app_details_full(appid)

    if api_status == "unavailable":
        return HealthResult(UNAVAILABLE, appid, name, link)

    if api_status == "not_found":
        return HealthResult(NOT_FOUND_404, appid, name, link)

    if api_status == "network_error":
        # Don't assume dead on network failure – transient
        return HealthResult(NETWORK_ERROR, appid, name, link)

    # api_status == "ok" → we have data, check if still free
    if data:
        resolved_name = data.get("name", name) or name
        is_free = data.get("is_free", False)
        price = data.get("price_overview", {})

        # Some F2P games have price_overview with initial=0
        if price:
            is_free = is_free or price.get("initial", 1) == 0

        if not is_free:
            return HealthResult(NOT_FREE, appid, resolved_name, link)

        return HealthResult(OK, appid, resolved_name, link)

    # 3) Fallback: HEAD the store page if API gave us nothing useful
    http_code = c.check_store_page(appid)
    if http_code == 404:
        return HealthResult(NOT_FOUND_404, appid, name, link)
    if http_code == 410:
        return HealthResult(NOT_FOUND_410, appid, name, link)
    if http_code == 200:
        return HealthResult(OK, appid, name, link)

    # Anything else – treat as transient
    return HealthResult(NETWORK_ERROR, appid, name, link)


# ──────────── Batch helper ────────────

def check_games_health(
    games: list[dict],
    client: Optional[SteamClient] = None,
) -> list[tuple[dict, HealthResult]]:
    """
    Check health for a list of game dicts.
    Returns list of (game_dict, HealthResult) pairs.
    Does NOT modify the input list.
    """
    c = client or get_client()
    results = []
    for g in games:
        link = g.get("link", "")
        name = g.get("name", "")
        result = check_game_health(link, name, client=c)
        results.append((g, result))
    return results
