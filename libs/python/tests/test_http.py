import urllib.error

import pytest

from altium_auth import _http
from altium_auth.errors import TransportError


class _FakeResp:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_response_json():
    assert _http.Response(status=200, text='{"a": 1}').json() == {"a": 1}


def test_request_returns_body_on_success(monkeypatch):
    monkeypatch.setattr(_http.urllib.request, "urlopen", lambda req, timeout: _FakeResp(200, b'{"ok": true}'))
    r = _http.request("GET", "https://x/y")
    assert r.status == 200
    assert r.json() == {"ok": True}


def test_request_returns_body_on_http_error(monkeypatch):
    def _raise(req, timeout):
        raise urllib.error.HTTPError("https://x/y", 400, "Bad", {}, fp=None)

    monkeypatch.setattr(_http.urllib.request, "urlopen", _raise)
    r = _http.request("POST", "https://x/y", data=b"a=1")
    assert r.status == 400  # 4xx returns a Response, does NOT raise


def test_request_raises_transport_error_on_network_failure(monkeypatch):
    def _raise(req, timeout):
        raise urllib.error.URLError("boom")

    monkeypatch.setattr(_http.urllib.request, "urlopen", _raise)
    with pytest.raises(TransportError):
        _http.request("POST", "https://x/y")
