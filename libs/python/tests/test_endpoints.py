from altium_auth.endpoints import (
    COMMERCIAL_CLOUD_ENDPOINTS,
    GOV_CLOUD_ENDPOINTS,
    AltiumEndpoints,
    aes_endpoints,
)


def test_commercial_constants():
    e = COMMERCIAL_CLOUD_ENDPOINTS
    assert e.authorize_endpoint == "https://auth.altium.com/connect/authorize"
    assert e.token_endpoint == "https://auth.altium.com/connect/token"
    assert e.action_wait_endpoint == "https://actionwait.altium.com/await"
    assert e.redirect_uri == "https://auth.altium.com/api/AuthComplete"
    assert e.scope_endpoint is None


def test_gov_constants_share_commercial_actionwait_and_redirect():
    e = GOV_CLOUD_ENDPOINTS
    assert e.authorize_endpoint == "https://auth.365-gov.altium.com/connect/authorize"
    assert e.token_endpoint == "https://auth.365-gov.altium.com/connect/token"
    assert e.action_wait_endpoint == "https://actionwait.altium.com/await"
    assert e.redirect_uri == "https://auth.altium.com/api/AuthComplete"


def test_aes_endpoints_derived_from_origin():
    e = aes_endpoints("https://aes.example.com:9785/")
    assert e.authorize_endpoint == "https://aes.example.com:9785/unifiedlogin/connect/authorize"
    assert e.token_endpoint == "https://aes.example.com:9785/unifiedlogin/connect/token"
    assert e.action_wait_endpoint == "https://aes.example.com:9785/actionwait/await"
    assert e.redirect_uri == "https://aes.example.com:9785/unifiedlogin/api/AuthComplete"
    assert e.scope_endpoint == "https://aes.example.com:9785/unifiedlogin/api/ClientScopes"


def test_endpoints_frozen():
    import dataclasses
    import pytest

    with pytest.raises(dataclasses.FrozenInstanceError):
        COMMERCIAL_CLOUD_ENDPOINTS.token_endpoint = "x"  # type: ignore[misc]
