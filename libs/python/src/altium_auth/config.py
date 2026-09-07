"""AltiumAuthConfig: client credentials + environment endpoints + derived flags."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlparse

from .endpoints import COMMERCIAL_CLOUD_ENDPOINTS, AltiumEndpoints


def _is_gov_host(token_endpoint: str) -> bool:
    """Gov hosts carry a 'gov' label (e.g. auth.365-gov.altium.com); Commercial/AES don't."""
    try:
        host = urlparse(token_endpoint).hostname or ""
    except ValueError:
        return False
    return "gov" in host.lower()


@dataclass(frozen=True)
class AltiumAuthConfig:
    """Configuration for an AltiumAuthClient.

    Only client_id and scopes are required. endpoints default to the Commercial
    Cloud; pass GOV_CLOUD_ENDPOINTS or aes_endpoints(origin) for other tiers.
    """

    client_id: str
    scopes: str
    client_secret: str | None = None
    endpoints: AltiumEndpoints = COMMERCIAL_CLOUD_ENDPOINTS
    secure: bool | None = None
    open_browser: Callable[[str], None] | None = None

    @property
    def is_confidential(self) -> bool:
        """True when a client_secret is set (confidential client → HTTP Basic)."""
        return bool(self.client_secret)

    @property
    def use_secure(self) -> bool:
        """Whether token requests must carry secure=1 (Gov). Override via `secure`."""
        if self.secure is not None:
            return self.secure
        return _is_gov_host(self.endpoints.token_endpoint)
