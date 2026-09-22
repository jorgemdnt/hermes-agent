"""SuperGrok weekly pool for ``xai-oauth``.

xAI does not publish a usage API for the OAuth subscription. grok.com Settings →
Usage reads ``GrokBuildBilling/GetGrokCreditsConfig`` over gRPC-web with the same
bearer token Hermes already stores. This module extracts only the usage percent
and period bounds. Unknown protobuf fields are ignored. A missing or rejected
response is an unavailable snapshot, never a guessed percentage.
"""

from __future__ import annotations

import math
import struct
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from agent.account_usage import AccountUsageSnapshot, AccountUsageWindow, _snapshot

_CREDITS_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig"
_SUBSCRIPTIONS_URL = "https://grok.com/rest/subscriptions"
_EMPTY_FRAME = b"\x00\x00\x00\x00\x00"
_TIMEOUT_S = 10.0


class XaiUsageParseError(ValueError):
    """The credits response did not contain a recognized usage percent."""


def _read_varint(data: bytes, offset: int) -> tuple[Optional[int], int]:
    value = 0
    shift = 0
    while offset < len(data) and shift < 64:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            return value, offset
        shift += 7
    return None, offset


def parse_xai_billing_grpc_web(raw: bytes, *, now: Optional[datetime] = None) -> dict[str, Any]:
    """Return ``percent_used`` plus optional window epochs from a gRPC-web body."""
    payloads: list[bytes] = []
    grpc_status: Optional[str] = None
    index = 0
    framed = False
    while index + 5 <= len(raw):
        flags = raw[index]
        length = int.from_bytes(raw[index + 1:index + 5], "big")
        end = index + 5 + length
        if end > len(raw):
            break
        framed = True
        frame = raw[index + 5:end]
        if flags & 0x80:
            for line in frame.decode("utf-8", errors="replace").splitlines():
                key, separator, value = line.partition(":")
                if separator and key.strip().lower() == "grpc-status":
                    grpc_status = value.strip()
        else:
            payloads.append(frame)
        index = end
    if framed and index != len(raw):
        raise XaiUsageParseError("malformed gRPC-web frames")
    if grpc_status not in (None, "0"):
        raise XaiUsageParseError(f"gRPC status {grpc_status}")
    if not payloads and raw and raw[0] >> 3:
        payloads = [raw]
    if not payloads:
        raise XaiUsageParseError("no protobuf payload")

    fixed32: list[tuple[tuple[int, ...], float, int]] = []
    varints: list[tuple[tuple[int, ...], int]] = []
    order = 0

    def scan(data: bytes, path: tuple[int, ...] = (), depth: int = 0) -> None:
        nonlocal order
        offset = 0
        while offset < len(data):
            field_start = offset
            key, offset = _read_varint(data, offset)
            if not key:
                offset = field_start + 1
                continue
            field_number, wire_type = key >> 3, key & 0x07
            field_path = path + (field_number,)
            if wire_type == 0:
                value, offset = _read_varint(data, offset)
                if value is not None:
                    varints.append((field_path, value))
            elif wire_type == 1:
                if offset + 8 > len(data):
                    break
                offset += 8
            elif wire_type == 2:
                length, offset = _read_varint(data, offset)
                if length is None or length > len(data) - offset:
                    offset = field_start + 1
                    continue
                nested = data[offset:offset + length]
                if depth < 4:
                    scan(nested, field_path, depth + 1)
                offset += length
            elif wire_type == 5:
                if offset + 4 > len(data):
                    break
                value = struct.unpack_from("<f", data, offset)[0]
                fixed32.append((field_path, value, order))
                order += 1
                offset += 4
            else:
                offset = field_start + 1

    for payload in payloads:
        scan(payload)

    candidates = [
        item for item in fixed32
        if item[0][-1:] == (1,) and math.isfinite(item[1]) and 0.0 <= item[1] <= 100.0
    ]
    exact = [item for item in candidates if item[0] == (1, 1)]
    picked = min(exact or candidates, key=lambda item: (len(item[0]), item[2])) if (exact or candidates) else None

    epoch_now = int((now or datetime.now(timezone.utc)).timestamp())
    timestamp_fields = {
        path: value for path, value in varints
        if 1_700_000_000 <= value <= 2_100_000_000
    }
    start_epoch = timestamp_fields.get((1, 4, 1)) or timestamp_fields.get((1, 8, 2, 1))
    end_epoch = timestamp_fields.get((1, 5, 1)) or timestamp_fields.get((1, 8, 3, 1))
    if end_epoch is None:
        future = sorted(value for value in timestamp_fields.values() if value > epoch_now)
        end_epoch = future[0] if future else None

    has_usage_period = any(
        (path[:2] == (1, 6)) or (path == (1, 8, 1) and value in (1, 2))
        for path, value in varints
    )
    percent_used = picked[1] if picked else (
        0.0 if not fixed32 and has_usage_period and end_epoch else None
    )
    if percent_used is None:
        raise XaiUsageParseError("no recognized usage percent")

    def from_epoch(epoch: Optional[int]) -> Optional[datetime]:
        if epoch is None:
            return None
        return datetime.fromtimestamp(int(epoch), tz=timezone.utc)

    return {
        "percent_used": round(float(percent_used), 3),
        "window_start": from_epoch(start_epoch),
        "window_end": from_epoch(end_epoch),
    }


def _plan_from_subscriptions(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    subs = payload.get("subscriptions")
    if not isinstance(subs, list):
        return None
    active = next(
        (item for item in subs if isinstance(item, dict) and item.get("status") == "SUBSCRIPTION_STATUS_ACTIVE"),
        None,
    )
    if not isinstance(active, dict):
        return None
    tier = str(active.get("tier") or "")
    prefix = "SUBSCRIPTION_TIER_"
    if tier.startswith(prefix):
        tier = tier[len(prefix):]
    cleaned = tier.replace("_", " ").strip()
    return cleaned.title() if cleaned else None


def _bearer(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Origin": "https://grok.com",
        "Referer": "https://grok.com/?_s=usage",
        "Accept": "*/*",
        "Content-Type": "application/grpc-web+proto",
        "x-grpc-web": "1",
        "x-user-agent": "connect-es/2.1.1",
    }


def _resolve_token(api_key: Optional[str]) -> Optional[str]:
    explicit = str(api_key or "").strip()
    if explicit:
        return explicit
    try:
        from hermes_cli.auth_xai import resolve_xai_oauth_runtime_credentials

        return str(resolve_xai_oauth_runtime_credentials().get("api_key") or "").strip() or None
    except Exception:
        return None


def fetch_xai_account_usage(
    _base_url: Optional[str] = None, api_key: Optional[str] = None,
) -> Optional[AccountUsageSnapshot]:
    """Weekly SuperGrok window, or an unavailable snapshot when the token exists but the UI API does not."""
    token = _resolve_token(api_key)
    if not token:
        return None
    headers = _bearer(token)
    plan: Optional[str] = None
    try:
        with httpx.Client(timeout=_TIMEOUT_S) as client:
            credits = client.post(_CREDITS_URL, content=_EMPTY_FRAME, headers=headers)
            credits.raise_for_status()
            grpc_status = credits.headers.get("grpc-status")
            if grpc_status not in (None, "0"):
                raise XaiUsageParseError(f"gRPC status {grpc_status}")
            parsed = parse_xai_billing_grpc_web(credits.content)
            try:
                subs = client.get(_SUBSCRIPTIONS_URL, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
                if subs.status_code == 200:
                    plan = _plan_from_subscriptions(subs.json())
            except Exception:
                plan = None
    except Exception as exc:
        return _snapshot(
            "xai-oauth", "grok_usage_ui", [], [],
            title="Account limits", plan=plan,
            unavailable_reason=f"Usage unavailable ({type(exc).__name__})",
        )
    span = None
    if parsed["window_start"] and parsed["window_end"]:
        span = (parsed["window_end"] - parsed["window_start"]).total_seconds()
    if span is not None and 6 * 86400 <= span <= 8 * 86400:
        label = "Weekly"
    elif span is not None and 27 * 86400 <= span <= 32 * 86400:
        label = "Monthly"
    else:
        label = "Usage"
    window = AccountUsageWindow(
        label=label,
        used_percent=float(parsed["percent_used"]),
        reset_at=parsed["window_end"],
    )
    return _snapshot("xai-oauth", "grok_usage_ui", [window], [], title="Account limits", plan=plan)
