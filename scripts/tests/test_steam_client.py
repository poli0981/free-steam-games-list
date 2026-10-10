"""
A store-page request that Steam answered with its age gate must never be read
as the game's page: parsed, the gate had no languages, no tags and no DLC
section, and wrote has_paid_dlc=False on every gated game. These pin how the
end of a request is classified, and what the client asks Steam for.

Run from the repository root:  python -m pytest scripts/tests
"""
import json

import pytest

from core import steam_client
from core.steam_client import STORE_AGE_COOKIES, SteamClient, store_page_status

APP = "https://store.steampowered.com/app/2279510/"
GATE = "https://store.steampowered.com/agecheck/app/2279510/"
LOGIN = "https://store.steampowered.com/login/?redir=https%3A%2F%2Fstore.steampowered.com%2Fagecheck%2Fapp%2F2279510%2F"


@pytest.mark.parametrize("final, history, expected", [
    (APP + "?l=english", [], "ok"),
    ("https://store.steampowered.com/app/2279510/SEXTS/", [], "ok"),
    # Measured 2026-10-10 for an Adult Only game: two redirects, 200 at the end.
    (LOGIN, [APP, GATE], "age_gate"),
    (GATE, [APP], "age_gate"),
    ("https://store.steampowered.com/login/", [], "age_gate"),
    ("https://store.steampowered.com/", [APP], "not_store"),          # delisted
    ("https://store.steampowered.com/app/2279511/", [APP], "not_store"),
    ("https://example.com/app/2279510/", [APP], "not_store"),
])
def test_where_a_request_ended_is_classified(final, history, expected):
    assert store_page_status("2279510", final, history) == expected


class _Resp:
    def __init__(self, url, text="", status_code=200, history=(), body=None):
        self.url, self.text, self.status_code = url, text, status_code
        self.history = [_Resp(u) for u in history]
        self._body = body
        self.headers: dict = {}

    def json(self):
        return self._body


class _Session:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests: list[dict] = []

    def get(self, url, params=None, timeout=None, cookies=None):
        self.requests.append({"url": url, "params": params or {}, "cookies": cookies})
        return self.answers.pop(0)


def _client(*answers) -> tuple[SteamClient, _Session]:
    client = SteamClient()
    session = _Session(*answers)
    client._session = session
    return client, session


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(steam_client.time, "sleep", lambda s: None)


def test_a_gate_is_never_handed_back_as_a_page():
    client, session = _client(_Resp(LOGIN, "<title>Sign In</title>", history=[APP, GATE]))
    assert client.fetch_store_page_full("2279510") == ("age_gate", None)
    [req] = session.requests
    assert req["params"] == {"l": "english"}
    assert req["cookies"] == STORE_AGE_COOKIES


def test_the_game_page_is_handed_back():
    client, _ = _client(_Resp(APP + "?l=english", "<html>page</html>"))
    assert client.fetch_store_page("2279510") == "<html>page</html>"


def test_a_404_is_not_found():
    client, _ = _client(_Resp(APP, status_code=404))
    assert client.fetch_store_page_full("2279510") == ("not_found", None)


def test_appdetails_asks_for_english():
    body = {"10": {"success": True, "data": {"name": "Counter-Strike"}}}
    client, session = _client(_Resp("https://store.steampowered.com/api/appdetails", body=body))
    assert client.fetch_app_details("10") == {"name": "Counter-Strike"}
    assert session.requests[0]["params"] == {"appids": "10", "l": "english"}
    assert session.requests[0]["cookies"] is None   # age cookies: store pages only


def test_store_items_are_keyed_by_the_id_asked_for():
    body = {"response": {"store_items": [
        {"id": 2279510, "appid": 2279510, "success": 1, "tags": []},
        {"id": 1, "appid": 0, "success": 15},                      # unknown to Steam
    ]}}
    client, session = _client(_Resp(steam_client.STORE_ITEMS_URL, body=body))
    items = client.fetch_store_items(["2279510", "1"])
    assert list(items) == ["2279510"]
    sent = json.loads(session.requests[0]["params"]["input_json"])
    assert sent["ids"] == [{"appid": 2279510}, {"appid": 1}]
    assert sent["context"]["language"] == "english"


def test_store_items_are_asked_for_in_batches_and_a_failed_batch_fails_all(monkeypatch):
    monkeypatch.setattr(steam_client, "STORE_ITEMS_BATCH", 2)
    ok = _Resp(steam_client.STORE_ITEMS_URL, body={"response": {"store_items": []}})
    client, session = _client(ok, _Resp(steam_client.STORE_ITEMS_URL, status_code=403))
    assert client.fetch_store_items(["1", "2", "3"]) is None
    assert len(session.requests) == 2


def test_tag_names_are_fetched_once():
    body = {"response": {"tags": [{"tagid": 12095, "name": "Sexual Content"}]}}
    client, session = _client(_Resp(steam_client.TAG_LIST_URL, body=body))
    assert client.fetch_tag_names() == {12095: "Sexual Content"}
    assert client.fetch_tag_names() == {12095: "Sexual Content"}
    assert len(session.requests) == 1
    assert session.requests[0]["params"] == {"language": "english"}
