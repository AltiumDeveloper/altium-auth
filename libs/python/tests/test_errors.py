from altium_auth.errors import (
    ActionWaitError,
    AltiumAuthError,
    ConfigurationError,
    OAuthError,
    StateMismatchError,
    TransportError,
    _truncate,
)


def test_hierarchy():
    for cls in (ConfigurationError, OAuthError, ActionWaitError, TransportError):
        assert issubclass(cls, AltiumAuthError)
    assert issubclass(StateMismatchError, ActionWaitError)
    assert issubclass(ConfigurationError, ValueError)


def test_oauth_error_carries_fields():
    err = OAuthError("boom", status=400, error="invalid_grant", error_description="nope")
    assert err.status == 400
    assert err.error == "invalid_grant"
    assert err.error_description == "nope"
    assert "boom" in str(err)


def test_truncate():
    assert _truncate("x" * 600) == "x" * 500
    assert _truncate("short") == "short"
