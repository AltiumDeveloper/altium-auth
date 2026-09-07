from urllib.parse import parse_qs

import pytest

from altium_auth import AltiumAuthClient, AltiumAuthConfig, _http
from altium_auth.endpoints import GOV_CLOUD_ENDPOINTS
from altium_auth.errors import OAuthError


class _Rec:
    def __init__(self, status, body):
        self.status, self.body, self.calls = status, body, []

    def __call__(self, method, url, *, headers=None, data=None, timeout=30.0):
        self.calls.append(
            {"method": method, "url": url, "headers": headers or {}, "body": (data or b"").decode()}
        )
        return _http.Response(status=self.status, text=self.body)


def _form(rec):
    return {k: v[0] for k, v in parse_qs(rec.calls[0]["body"], keep_blank_values=True).items()}


def test_public_code_exchange(monkeypatch):
    rec = _Rec(200, '{"access_token": "AT", "token_type": "Bearer", "expires_in": 3600}')
    monkeypatch.setattr(_http, "request", rec)
    client = AltiumAuthClient(AltiumAuthConfig(client_id="test-client-id", scopes="openid profile"))
    tok = client.exchange_code(
        "auth-code", code_verifier="verifier-123", redirect_uri="https://app.example.com/cb"
    )
    assert tok.access_token == "AT"
    assert tok.expires_at is not None
    assert rec.calls[0]["url"] == "https://auth.altium.com/connect/token"
    assert "Authorization" not in rec.calls[0]["headers"]
    f = _form(rec)
    assert f["grant_type"] == "authorization_code"
    assert f["code"] == "auth-code"
    assert f["code_verifier"] == "verifier-123"
    assert f["client_id"] == "test-client-id"
    assert "secure" not in f and "client_secret" not in f


def test_confidential_uses_basic_and_omits_client_id(monkeypatch):
    rec = _Rec(200, '{"access_token": "AT"}')
    monkeypatch.setattr(_http, "request", rec)
    client = AltiumAuthClient(
        AltiumAuthConfig(
            client_id="test-client-id", client_secret="s3cret", scopes="openid profile"
        )
    )
    client.exchange_code("c", code_verifier="v")
    assert rec.calls[0]["headers"]["Authorization"] == "Basic dGVzdC1jbGllbnQtaWQ6czNjcmV0"
    assert "client_id" not in _form(rec)


def test_workspace_exchange_gov_bridge_adds_secure(monkeypatch):
    rec = _Rec(200, '{"access_token": "GOV-WS-AT"}')
    monkeypatch.setattr(_http, "request", rec)
    client = AltiumAuthClient(
        AltiumAuthConfig(
            client_id="test-client-id", scopes="openid profile", endpoints=GOV_CLOUD_ENDPOINTS
        )
    )
    client.sign_into_workspace("commercial-global-AT", "gov-ws")
    assert rec.calls[0]["url"] == "https://auth.365-gov.altium.com/connect/token"
    f = _form(rec)
    assert f["grant_type"] == "urn:ietf:params:oauth:grant-type:token-exchange"
    assert f["subject_token"] == "commercial-global-AT"
    assert "a365:workspace:gov-ws" in f["scope"]
    assert f["secure"] == "1"


def test_refresh_sends_no_scope(monkeypatch):
    rec = _Rec(200, '{"access_token": "AT2"}')
    monkeypatch.setattr(_http, "request", rec)
    client = AltiumAuthClient(AltiumAuthConfig(client_id="test-client-id", scopes="openid profile"))
    client.refresh_token("RT")
    f = _form(rec)
    assert f["grant_type"] == "refresh_token"
    assert f["refresh_token"] == "RT"
    assert "scope" not in f and "secure" not in f


def test_oauth_error_surfaces_error_code(monkeypatch):
    rec = _Rec(400, '{"error": "access_denied"}')
    monkeypatch.setattr(_http, "request", rec)
    client = AltiumAuthClient(AltiumAuthConfig(client_id="test-client-id", scopes="openid profile"))
    with pytest.raises(OAuthError) as ei:
        client.sign_into_workspace("global-AT", "gov-ws")
    assert "access_denied" in str(ei.value)
