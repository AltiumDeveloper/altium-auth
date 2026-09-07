"""Public value types: WorkspaceSelection, TokenSet, AuthorizationRequest."""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from typing import Any

_CLOCK_SKEW_SECONDS = 30


class WorkspaceSelection(str, Enum):
    """login-into-workspace mode for /authorize (SPEC §3.1)."""

    NONE = "none"
    STRICT = "strict"
    OPTIONAL = "optional"


@dataclass
class TokenSet:
    """OAuth2 token response (RFC 6749 / OIDC)."""

    access_token: str
    token_type: str | None = None
    expires_in: int | None = None
    expires_at: int | None = None
    refresh_token: str | None = None
    id_token: str | None = None
    scope: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TokenSet:
        """Build a TokenSet from a parsed JSON dict, computing expires_at if absent."""
        expires_in = data.get("expires_in")
        expires_at = data.get("expires_at")
        if expires_in and not expires_at:
            expires_at = int(time.time()) + int(expires_in) - _CLOCK_SKEW_SECONDS
        return cls(
            access_token=data["access_token"],
            token_type=data.get("token_type"),
            expires_in=expires_in,
            expires_at=expires_at,
            refresh_token=data.get("refresh_token"),
            id_token=data.get("id_token"),
            scope=data.get("scope"),
        )


@dataclass(frozen=True)
class AuthorizationRequest:
    """A prepared authorization request: where to send the user, and what to stash."""

    url: str
    state: str
    code_verifier: str
