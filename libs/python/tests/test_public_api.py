import altium_auth


def test_public_surface():
    expected = {
        "AltiumAuthClient",
        "AltiumAuthConfig",
        "AltiumEndpoints",
        "TokenSet",
        "AuthorizationRequest",
        "WorkspaceSelection",
        "COMMERCIAL_CLOUD_ENDPOINTS",
        "GOV_CLOUD_ENDPOINTS",
        "aes_endpoints",
        "AltiumAuthError",
        "ConfigurationError",
        "OAuthError",
        "ActionWaitError",
        "StateMismatchError",
        "TransportError",
    }
    assert expected <= set(altium_auth.__all__)
    for name in expected:
        assert hasattr(altium_auth, name), name


def test_top_level_imports():
    from altium_auth import AltiumAuthClient, AltiumAuthConfig  # noqa: F401
