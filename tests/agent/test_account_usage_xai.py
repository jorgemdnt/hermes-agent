"""xAI weekly quota: parse the unpublished gRPC-web body, never invent a percent."""

from __future__ import annotations

import struct
from datetime import datetime, timezone

import httpx
import pytest

from agent.account_usage_xai import XaiUsageParseError, fetch_xai_account_usage, parse_xai_billing_grpc_web


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _key(field: int, wire: int) -> bytes:
    return _varint((field << 3) | wire)


def _length_delimited(field: int, payload: bytes) -> bytes:
    return _key(field, 2) + _varint(len(payload)) + payload


def _fixed32(field: int, value: float) -> bytes:
    return _key(field, 5) + struct.pack("<f", value)


def _weekly_frame(percent: float, start: int, end: int) -> bytes:
    inner = (
        _fixed32(1, percent)
        + _length_delimited(4, _key(1, 0) + _varint(start))
        + _length_delimited(5, _key(1, 0) + _varint(end))
        + _key(6, 0) + _varint(1)
    )
    payload = _length_delimited(1, inner)
    return b"\x00" + len(payload).to_bytes(4, "big") + payload


def test_parse_weekly_percent_and_reset():
    raw = _weekly_frame(42.5, 1_700_000_000, 1_800_000_000)
    parsed = parse_xai_billing_grpc_web(raw, now=datetime.fromtimestamp(1_750_000_000, tz=timezone.utc))
    assert parsed["percent_used"] == 42.5
    assert parsed["window_end"] == datetime.fromtimestamp(1_800_000_000, tz=timezone.utc)


def test_parse_rejects_a_body_with_no_percent():
    with pytest.raises(XaiUsageParseError):
        parse_xai_billing_grpc_web(b"")


def test_fetch_returns_weekly_window(monkeypatch):
    frame = _weekly_frame(17.0, 1_700_000_000, 1_700_000_000 + 7 * 86400)

    class _Response:
        def __init__(self, content: bytes, status_code: int = 200, headers: dict | None = None, json_body=None):
            self.content = content
            self.status_code = status_code
            self.headers = headers or {}
            self._json = json_body

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("nope", request=httpx.Request("POST", "https://grok.com"), response=httpx.Response(self.status_code))

        def json(self):
            return self._json

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, content, headers):
            assert url.endswith("GetGrokCreditsConfig")
            assert headers["Authorization"] == "Bearer token"
            assert content == b"\x00\x00\x00\x00\x00"
            return _Response(frame, headers={"grpc-status": "0"})

        def get(self, url, headers):
            return _Response(b"", json_body={
                "subscriptions": [{"status": "SUBSCRIPTION_STATUS_ACTIVE", "tier": "SUBSCRIPTION_TIER_SUPER_GROK"}],
            })

    monkeypatch.setattr("agent.account_usage_xai.httpx.Client", _Client)
    snapshot = fetch_xai_account_usage(api_key="token")
    assert snapshot is not None
    assert snapshot.available
    assert snapshot.plan == "Super Grok"
    assert snapshot.windows[0].label == "Weekly"
    assert snapshot.windows[0].used_percent == 17.0
    assert snapshot.raw is None


def test_fetch_without_a_token_is_absent(monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.auth_xai.resolve_xai_oauth_runtime_credentials",
        lambda **kwargs: {"api_key": ""},
    )
    assert fetch_xai_account_usage() is None


def test_fetch_failure_is_unavailable_not_a_guess(monkeypatch):
    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            raise httpx.ConnectError("down")

    monkeypatch.setattr("agent.account_usage_xai.httpx.Client", _Client)
    snapshot = fetch_xai_account_usage(api_key="token")
    assert snapshot is not None
    assert not snapshot.available
    assert snapshot.windows == ()
    assert snapshot.unavailable_reason
