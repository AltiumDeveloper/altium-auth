from urllib.parse import parse_qs, urlparse

import pytest

from altium_auth import AltiumAuthClient, AltiumAuthConfig
from altium_auth.endpoints import GOV_CLOUD_ENDPOINTS
from altium_auth.errors import ConfigurationError
from altium_auth.models import WorkspaceSelection


def _query(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query, keep_blank_values=True).items()}


def test_rejects_empty_client_id():
    with pytest.raises(ConfigurationError):
        AltiumAuthClient(AltiumAuthConfig(client_id="  ", scopes="openid"))


def test_authorize_url_shape_commercial():
    client = AltiumAuthClient(AltiumAuthConfig(client_id="test-client-id", scopes="openid profile"))
    req = client.create_authorization_url(
        redirect_uri="https://app.example.com/cb", state="state-123", code_verifier="verifier-123"
    )
    u = urlparse(req.url)
    assert f"{u.scheme}://{u.netloc}" == "https://auth.altium.com"
    assert u.path == "/connect/authorize"
    q = _query(req.url)
    assert q["response_type"] == "code"
    assert q["client_id"] == "test-client-id"
    assert q["redirect_uri"] == "https://app.example.com/cb"
    assert q["scope"] == "openid profile"
    assert q["code_challenge_method"] == "S256"
    assert q["code_challenge"] == "Ds3NpaREu9I2EYq6l0l3ZkFyv_Gt5O4EpGD6cZlY0Kg"
    assert q["state"] == "state-123"
    assert "secure" not in q and "selectWorkspace" not in q
    assert req.state == "state-123"
    assert req.code_verifier == "verifier-123"


def test_select_workspace_emitted_only_when_strict_or_optional():
    client = AltiumAuthClient(AltiumAuthConfig(client_id="c", scopes="openid profile"))
    strict = _query(client.create_authorization_url(select_workspace=WorkspaceSelection.STRICT).url)
    assert strict["selectWorkspace"] == "strict"
    none = _query(client.create_authorization_url(select_workspace=WorkspaceSelection.NONE).url)
    assert "selectWorkspace" not in none


def test_gov_authorize_has_no_secure():
    client = AltiumAuthClient(
        AltiumAuthConfig(client_id="gov", scopes="openid", endpoints=GOV_CLOUD_ENDPOINTS)
    )
    q = _query(client.create_authorization_url(state="s", code_verifier="v").url)
    assert "secure" not in q
    assert urlparse(client.create_authorization_url().url).netloc == "auth.365-gov.altium.com"


def test_defaults_generate_state_and_verifier():
    client = AltiumAuthClient(AltiumAuthConfig(client_id="c", scopes="openid"))
    req = client.create_authorization_url()
    assert req.state and req.code_verifier
    assert _query(req.url)["state"] == req.state
