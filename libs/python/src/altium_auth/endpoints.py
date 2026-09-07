"""Environment endpoint sets: Commercial + GovCloud constants and the AES factory."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AltiumEndpoints:
    """The OAuth endpoints for one Altium environment (plus optional scope endpoint)."""

    authorize_endpoint: str
    token_endpoint: str
    action_wait_endpoint: str
    redirect_uri: str
    scope_endpoint: str | None = None


COMMERCIAL_CLOUD_ENDPOINTS = AltiumEndpoints(
    authorize_endpoint="https://auth.altium.com/connect/authorize",
    token_endpoint="https://auth.altium.com/connect/token",
    action_wait_endpoint="https://actionwait.altium.com/await",
    redirect_uri="https://auth.altium.com/api/AuthComplete",
)

# Only authorize/token are gov-specific; ActionWait + AuthComplete stay on the
# Commercial hosts for the tier (SPEC §4.2 — a gov-host callback isn't registered).
GOV_CLOUD_ENDPOINTS = AltiumEndpoints(
    authorize_endpoint="https://auth.365-gov.altium.com/connect/authorize",
    token_endpoint="https://auth.365-gov.altium.com/connect/token",
    action_wait_endpoint="https://actionwait.altium.com/await",
    redirect_uri="https://auth.altium.com/api/AuthComplete",
)


def aes_endpoints(origin: str) -> AltiumEndpoints:
    """Derive endpoints for an AES (on-prem) installation from its server origin.

    AES hosts its own ActionWait and AuthComplete callback (unlike Gov, which
    shares Commercial's) and does not use secure=1 (same rule as Commercial).
    """
    base = origin.rstrip("/")
    return AltiumEndpoints(
        authorize_endpoint=f"{base}/unifiedlogin/connect/authorize",
        token_endpoint=f"{base}/unifiedlogin/connect/token",
        action_wait_endpoint=f"{base}/actionwait/await",
        redirect_uri=f"{base}/unifiedlogin/api/AuthComplete",
        scope_endpoint=f"{base}/unifiedlogin/api/ClientScopes",
    )
