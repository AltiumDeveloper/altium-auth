from altium_auth.config import AltiumAuthConfig
from altium_auth.endpoints import GOV_CLOUD_ENDPOINTS, aes_endpoints


def test_defaults_to_commercial_public():
    c = AltiumAuthConfig(client_id="cid", scopes="openid profile")
    assert c.is_confidential is False
    assert c.use_secure is False  # commercial token host
    assert c.endpoints.token_endpoint == "https://auth.altium.com/connect/token"


def test_confidential_when_secret_present():
    c = AltiumAuthConfig(client_id="cid", scopes="openid", client_secret="s")
    assert c.is_confidential is True


def test_use_secure_true_for_gov_host():
    c = AltiumAuthConfig(client_id="cid", scopes="openid", endpoints=GOV_CLOUD_ENDPOINTS)
    assert c.use_secure is True


def test_use_secure_false_for_aes_host():
    c = AltiumAuthConfig(
        client_id="cid", scopes="openid", endpoints=aes_endpoints("https://aes.example.com:9785")
    )
    assert c.use_secure is False


def test_secure_override_wins_both_ways():
    gov = AltiumAuthConfig(client_id="c", scopes="o", endpoints=GOV_CLOUD_ENDPOINTS, secure=False)
    assert gov.use_secure is False
    com = AltiumAuthConfig(client_id="c", scopes="o", secure=True)
    assert com.use_secure is True
