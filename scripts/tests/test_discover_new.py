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
