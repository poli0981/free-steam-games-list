"""
check_game_health() is the confirmation every removal goes through: purge
asks it about the games Steam's store API flags, and ingest about every queued
link. These pin how appdetails' answers map to a verdict.

Steam is never called: the client is a fake. Run from the repository root:
python -m pytest scripts/tests
"""
import pytest

from core import health_checker as hc

LINK = "https://store.steampowered.com/app/730/"


class FakeClient:
    def __init__(self, status="ok", data=None, head=200):
        self.status, self.data, self.head = status, data, head

    def fetch_app_details_full(self, appid):
        return (self.status, self.data)

    def check_store_page(self, appid):
        return self.head


@pytest.mark.parametrize("data, expected", [
    ({"is_free": True}, True),
    ({"is_free": False, "price_overview": {"initial": 0}}, True),
    ({"is_free": False, "price_overview": {"initial": 1499}}, False),
    ({"is_free": False, "price_overview": None}, False),
    ({}, False),
])
def test_what_appdetails_calls_free(data, expected):
    assert hc.free_per_appdetails(data) is expected


@pytest.mark.parametrize("client, status", [
    (FakeClient(data={"name": "CS2", "is_free": True}), hc.OK),
    (FakeClient(data={"name": "CS2", "is_free": False, "price_overview": {"initial": 999}}), hc.NOT_FREE),
    (FakeClient(data={"name": "CS2", "is_free": True, "release_date": {"coming_soon": True}}), hc.COMING_SOON),
    (FakeClient(status="unavailable"), hc.UNAVAILABLE),
    (FakeClient(status="not_found"), hc.NOT_FOUND_404),
    (FakeClient(status="network_error"), hc.NETWORK_ERROR),
    (FakeClient(data={}, head=404), hc.NOT_FOUND_404),
    (FakeClient(data={}, head=410), hc.NOT_FOUND_410),
    (FakeClient(data={}, head=200), hc.OK),
    (FakeClient(data={}, head=-1), hc.NETWORK_ERROR),
])
def test_appdetails_answers_map_to_a_verdict(client, status):
    result = hc.check_game_health(LINK, "Counter-Strike 2", client)
    assert result.status == status and result.appid == "730"
    assert result.should_remove is (status in hc.REMOVABLE)


def test_a_link_without_an_appid_is_invalid_without_a_request():
    result = hc.check_game_health("https://example.com/", "x", object())
    assert result.status == hc.INVALID_FORMAT and result.should_remove
