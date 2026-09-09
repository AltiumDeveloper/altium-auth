from urllib.parse import parse_qs

import pytest

from altium_auth import AltiumAuthClient, AltiumAuthConfig, _http
from altium_auth.errors import OAuthError


class _Rec:
    def __init__(self, status, body):
        self.status, self.body, self.calls = status, body, []

    def __call__(self, method, url, *, headers=None, data=None, timeout=30.0):
        self.calls.append(
            {"method": method, "url": url, "headers": headers or {}, "body": (data or b"").decode()}
        )
        return _http.Response(status=self.status, text=self.body)


def test_revoke_shape(monkeypatch):
    rec = _Rec(200, "")
    monkeypatch.setattr(_http, "request", rec)
    client = AltiumAuthClient(AltiumAuthConfig(client_id="test-client-id", scopes="openid profile"))
    client.revoke_refresh_token("RT")
    assert rec.calls[0]["url"] == "https://auth.altium.com/connect/revocation"
    assert rec.calls[0]["method"] == "POST"
    assert "Authorization" not in rec.calls[0]["headers"]
    f = {k: v[0] for k, v in parse_qs(rec.calls[0]["body"], keep_blank_values=True).items()}
    assert f["token"] == "RT"
    assert f["token_type_hint"] == "refresh_token"
    assert f["client_id"] == "test-client-id"


def test_revoke_non_2xx_raises(monkeypatch):
    monkeypatch.setattr(_http, "request", _Rec(500, "boom"))
    client = AltiumAuthClient(AltiumAuthConfig(client_id="c", scopes="openid"))
    with pytest.raises(OAuthError):
        client.revoke_refresh_token("RT")


def test_get_client_scopes_returns_array(monkeypatch):
    rec = _Rec(200, '["a365:workspace:11111111-1111-1111-1111-111111111111", "openid"]')
    monkeypatch.setattr(_http, "request", rec)
    result = AltiumAuthClient.get_client_scopes(
        "https://aes.example.com:9785/unifiedlogin/api/ClientScopes", "test-client-id"
    )
    assert result == ["a365:workspace:11111111-1111-1111-1111-111111111111", "openid"]
    assert (
        rec.calls[0]["url"]
        == "https://aes.example.com:9785/unifiedlogin/api/ClientScopes?clientId=test-client-id"
    )
    assert rec.calls[0]["method"] == "GET"


def test_get_client_scopes_unknown_client_empty(monkeypatch):
    monkeypatch.setattr(_http, "request", _Rec(200, "[]"))
    assert AltiumAuthClient.get_client_scopes("https://x/api/ClientScopes", "unknown") == []


def test_get_client_scopes_non_array_is_error(monkeypatch):
    monkeypatch.setattr(_http, "request", _Rec(200, "null"))
    with pytest.raises(OAuthError) as ei:
        AltiumAuthClient.get_client_scopes("https://x/api/ClientScopes", "c")
    assert "expected a JSON array of strings" in str(ei.value)


def test_get_client_scopes_non_200_is_error(monkeypatch):
    monkeypatch.setattr(_http, "request", _Rec(500, "<html>Server Error</html>"))
    with pytest.raises(OAuthError) as ei:
        AltiumAuthClient.get_client_scopes("https://x/api/ClientScopes", "c")
    assert "500" in str(ei.value)
