"""
Health checker v2.1 – game status detection.
"""
from dataclasses import dataclass
from typing import Optional
from .data_store import extract_appid
from .steam_client import SteamClient, get_client

OK = "ok"
INVALID_FORMAT = "invalid_format"
NOT_FOUND_404 = "not_found_404"
NOT_FOUND_410 = "not_found_410"
UNAVAILABLE = "unavailable"
NOT_FREE = "not_free"
NETWORK_ERROR = "network_error"

REMOVABLE = frozenset({INVALID_FORMAT, NOT_FOUND_404, NOT_FOUND_410, UNAVAILABLE, NOT_FREE})

REASON_LABELS = {
    INVALID_FORMAT: "Invalid link format",
    NOT_FOUND_404: "Store page 404",
    NOT_FOUND_410: "Store page 410 – removed",
    UNAVAILABLE: "Delisted / unavailable",
    NOT_FREE: "No longer free-to-play",
    NETWORK_ERROR: "Network error (skipped)",
    OK: "Healthy",
}


@dataclass(slots=True)
class HealthResult:
    status: str
    appid: Optional[str]
    name: str
    link: str
    data: Optional[dict] = None  # Cache API response to avoid double-fetch

    @property
    def is_healthy(self): return self.status == OK

    @property
    def should_remove(self): return self.status in REMOVABLE

    @property
    def reason(self): return REASON_LABELS.get(self.status, self.status)


def check_game_health(link: str, name: str = "",
                      client: Optional[SteamClient] = None) -> HealthResult:
    """
    Check game health. Returns HealthResult with cached API data
    so caller can skip a second fetch_app_details call.
    """
    c = client or get_client()
    appid = extract_appid(link)
    if not appid:
        return HealthResult(INVALID_FORMAT, None, name, link)

    api_status, data = c.fetch_app_details_full(appid)

    if api_status == "unavailable":
        return HealthResult(UNAVAILABLE, appid, name, link)
    if api_status == "not_found":
        return HealthResult(NOT_FOUND_404, appid, name, link)
    if api_status == "network_error":
        return HealthResult(NETWORK_ERROR, appid, name, link)

    # api_status == "ok"
    if data:
        resolved = data.get("name", name) or name
        is_free = data.get("is_free", False)
        price = data.get("price_overview", {})
        if price:
            is_free = is_free or price.get("initial", 1) == 0
        if not is_free:
            return HealthResult(NOT_FREE, appid, resolved, link)
        # Healthy – return data so caller can reuse it
        return HealthResult(OK, appid, resolved, link, data=data)

    # Fallback HEAD
    code = c.check_store_page(appid)
    if code == 404: return HealthResult(NOT_FOUND_404, appid, name, link)
    if code == 410: return HealthResult(NOT_FOUND_410, appid, name, link)
    if code == 200: return HealthResult(OK, appid, name, link)
    return HealthResult(NETWORK_ERROR, appid, name, link)
