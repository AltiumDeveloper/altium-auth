import re

from altium_auth.pkce import base64url_encode, code_challenge, generate_code_verifier

_B64URL = re.compile(r"^[A-Za-z0-9_-]+$")


def test_base64url_no_padding():
    assert base64url_encode(b"\x00\x01\x02\x03") == "AAECAw"
    assert "=" not in base64url_encode(b"any bytes here")


def test_code_challenge_is_deterministic_and_known():
    # base64url(SHA256(verifier)), no padding — pinned values.
    assert code_challenge("verifier-123") == "Ds3NpaREu9I2EYq6l0l3ZkFyv_Gt5O4EpGD6cZlY0Kg"
    assert code_challenge("v") == "TJRIXgwhrmxBzh3-e2v6zupato5AokdvUCCOUm9QYIA"


def test_generate_verifier_is_high_entropy_urlsafe():
    v = generate_code_verifier()
    assert _B64URL.match(v)
    assert len(v) >= 43  # 32 bytes → 43 base64url chars (unpadded)
    assert generate_code_verifier() != generate_code_verifier()
