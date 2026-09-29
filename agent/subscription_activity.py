"""Cross-process, secret-free attribution of a model call to its selected account.

The dashboard runs separately from the agent. This marker is observational only:
absence or a stale in-flight call never selects an account or changes routing.
"""
from __future__ import annotations

import time
from pathlib import Path

from hermes_constants import get_hermes_home
from hermes_cli.auth import _auth_store_lock
from utils import atomic_json_write

PROVIDERS = {"openai-codex", "xai-oauth", "anthropic"}


def _path() -> Path:
    return Path(get_hermes_home()) / "runtime" / "subscription-activity.json"


def _read() -> dict:
    import json
    try:
        return json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}


def mark(provider: str, account_id: str, session_id: str, request_id: str, phase: str) -> None:
    """Telemetry must never interrupt a model request."""
    try:
        _mark(provider, account_id, session_id, request_id, phase)
    except Exception:
        pass


def _mark(provider: str, account_id: str, session_id: str, request_id: str, phase: str) -> None:
    if provider not in PROVIDERS or not account_id or phase not in ("in_flight", "finished", "failed"):
        return
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with _auth_store_lock(target_path=path):
        rows = _read()
        key = f"{provider}:{session_id}"
        prior = rows.get(key, {})
        if phase != "in_flight" and prior.get("request_id") != request_id:
            return  # An older call must not clobber a newer selection.
        rows[key] = {"provider": provider, "account_id": account_id, "session_id": session_id,
                     "request_id": request_id, "phase": phase, "at": time.time()}
        rows = {k: v for k, v in rows.items() if time.time() - v.get("at", 0) < 86400}
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        atomic_json_write(path, rows, mode=0o600)


def latest(provider: str, session_id: str | None = None) -> dict | None:
    rows = [v for v in _read().values() if isinstance(v, dict) and v.get("provider") == provider
            and (session_id is None or v.get("session_id") == session_id)
            and time.time() - v.get("at", 0) < 86400]
    if not rows:
        return None
    row = max(rows, key=lambda v: v["at"])
    if row["phase"] == "in_flight" and time.time() - row["at"] > 300:
        return None  # Process died without finalization.
    return row
