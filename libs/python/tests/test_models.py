import time

from altium_auth.models import AuthorizationRequest, TokenSet, WorkspaceSelection


def test_workspace_selection_values():
    assert WorkspaceSelection.NONE.value == "none"
    assert WorkspaceSelection.STRICT.value == "strict"
    assert WorkspaceSelection.OPTIONAL.value == "optional"
    assert WorkspaceSelection("optional") is WorkspaceSelection.OPTIONAL


def test_tokenset_from_dict_minimal():
    tok = TokenSet.from_dict({"access_token": "AT", "token_type": "Bearer"})
    assert tok.access_token == "AT"
    assert tok.token_type == "Bearer"
    assert tok.expires_at is None


def test_tokenset_computes_expires_at_with_30s_skew():
    now = int(time.time())
    tok = TokenSet.from_dict({"access_token": "AT", "expires_in": 3600})
    assert tok.expires_at is not None
    assert abs(tok.expires_at - (now + 3600 - 30)) <= 5


def test_tokenset_keeps_explicit_expires_at():
    tok = TokenSet.from_dict({"access_token": "AT", "expires_in": 3600, "expires_at": 42})
    assert tok.expires_at == 42


def test_authorization_request_fields():
    req = AuthorizationRequest(url="https://x/y?z=1", state="s", code_verifier="v")
    assert (req.url, req.state, req.code_verifier) == ("https://x/y?z=1", "s", "v")
