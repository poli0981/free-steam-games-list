"""How discover_new reads the redirect Cloudflare Access answers with."""
import discover_new


def test_an_access_login_redirect_is_explained():
    out = discover_new._describe_access_redirect(
        "https://team.cloudflareaccess.com/cdn-cgi/access/login/free-steam-games.win?meta=a.e30.b"
    )
    assert out.startswith("Cloudflare Access redirected to its LOGIN PAGE")


def test_a_lookalike_host_is_not_taken_for_access():
    # Without the dot in the suffix check, this host also "ended with
    # cloudflareaccess.com" (CodeQL py/incomplete-url-substring-sanitization).
    out = discover_new._describe_access_redirect("https://evilcloudflareaccess.com/cdn-cgi/access/login/x")
    assert out.startswith("unexpected redirect to")


def test_removed_games_count_as_known(tmp_path, monkeypatch):
    # A game the maintainer took out must not be proposed again; the D1
    # decision is one fence, the blocklist read here is the other.
    import os
    from core import data_store
    from core.blocklist import make_entry, serialize_entry

    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    data_store.save_main([{"link": "https://store.steampowered.com/app/1/", "name": "One"}],
                         apply_human_overrides=False)
    with open(os.path.join("data", "blocklist.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        f.write(serialize_entry(make_entry("2", "Two", "not_free", "", "2026-10-13T12:00:00Z")) + "\n")
    assert discover_new.catalogue_appids() == {"1", "2"}
