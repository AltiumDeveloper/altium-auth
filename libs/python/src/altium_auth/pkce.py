"""PKCE (RFC 7636) helpers: verifier, S256 challenge, base64url encoding."""

from __future__ import annotations

import base64
import hashlib
import secrets


def base64url_encode(data: bytes) -> str:
    """Base64url-encode bytes without padding (RFC 7515 §2)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_code_verifier() -> str:
    """Generate a high-entropy PKCE code verifier: base64url of 32 random bytes."""
    return base64url_encode(secrets.token_bytes(32))


def code_challenge(verifier: str) -> str:
    """Derive the S256 code challenge for a verifier: base64url(SHA256(verifier))."""
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64url_encode(digest)
