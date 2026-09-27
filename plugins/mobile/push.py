"""Dashboard mobile Web Push: one authenticated browser subscription store per dashboard."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import threading
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

log = logging.getLogger(__name__)
_lock = threading.RLock()
_PUSH_HOSTS = {"web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"}


def _directory(home: Path) -> Path:
    directory = home / "mobile"
    directory.mkdir(mode=0o700, exist_ok=True)
    return directory


def _private_key(home: Path) -> Path:
    path = _directory(home) / "vapid.pem"
    with _lock:
        if not path.exists():
            key = ec.generate_private_key(ec.SECP256R1())
            encoded = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption())
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as out:
                out.write(encoded)
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError("VAPID key must be a private 0600 file")
    return path


def public_key(home: Path) -> str:
    key = serialization.load_pem_private_key(_private_key(home).read_bytes(), password=None)
    return base64.urlsafe_b64encode(key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).rstrip(b"=").decode("ascii")


def validate_subscription(subscription: dict) -> dict:
    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys")
    if not isinstance(endpoint, str) or len(endpoint) > 2048:
        raise ValueError("Invalid push endpoint")
    url = urlsplit(endpoint)
    if url.scheme != "https" or url.hostname not in _PUSH_HOSTS or url.username or url.password or url.port:
        raise ValueError("Push endpoint must be an approved HTTPS push service")
    if not isinstance(keys, dict) or not all(isinstance(keys.get(k), str) and
                                              10 <= len(keys[k]) <= 256 for k in ("p256dh", "auth")):
        raise ValueError("Invalid push keys")
    return {"endpoint": endpoint, "keys": {k: keys[k] for k in ("p256dh", "auth")}}


def _read(home: Path) -> dict[str, dict]:
    path = _directory(home) / "subscriptions.json"
    if not path.exists():
        return {}
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("Push subscription store must be a private 0600 file")
    data = json.loads(path.read_text())
    return data if isinstance(data, dict) else {}


def _save(home: Path, rows: dict[str, dict]) -> None:
    path = _directory(home) / "subscriptions.json"
    staging = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(staging, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as out:
            json.dump(rows, out)
            out.flush()
            os.fsync(out.fileno())
        staging.replace(path)
    finally:
        staging.unlink(missing_ok=True)


def subscribe(home: Path, subscription: dict, user_id: str, browser_id: str | None = None) -> None:
    item = validate_subscription(subscription)
    with _lock:
        rows = _read(home)
        if item["endpoint"] not in rows and len(rows) >= 8:
            raise ValueError("Too many push subscriptions")
        rows[item["endpoint"]] = {"subscription": item, "user_id": user_id,
                                  "browser_id": browser_id}
        _save(home, rows)


def unsubscribe(home: Path, endpoint: str, user_id: str) -> None:
    with _lock:
        rows = _read(home)
        if rows.get(endpoint, {}).get("user_id") == user_id:
            rows.pop(endpoint)
            _save(home, rows)

def unsubscribe_browser(home: Path, user_id: str, browser_id: str) -> None:
    """Signing out removes only this browser's endpoints, even across profiles."""
    with _lock:
        rows = _read(home)
        remaining = {endpoint: row for endpoint, row in rows.items()
                     if row.get("user_id") != user_id or row.get("browser_id") != browser_id}
        if len(remaining) != len(rows):
            _save(home, remaining)


def has_subscriptions(home: Path) -> bool:
    with _lock:
        return bool(_read(home))


def send_pending(home: Path, profile: str, kind: str, request_id: str) -> bool:
    """Return whether an enrolled phone can be notified; never include prompt details."""
    with _lock:
        rows = list(_read(home).values())
    if not rows:
        return False
    from pywebpush import WebPushException, webpush

    payload = json.dumps({"profile": profile, "kind": kind, "request_id": request_id})
    key = str(_private_key(home))
    delivered = False
    for row in rows:
        try:
            response = webpush(subscription_info=row["subscription"], data=payload,
                               vapid_private_key=key, vapid_claims={"sub": "mailto:mobile@hermes-agent.local"},
                               timeout=10, ttl=180)
            if response.status_code in (200, 201, 202):
                delivered = True
            else:
                log.warning("Mobile push failed with HTTP %s", response.status_code)
        except WebPushException as exc:
            if exc.response is not None and exc.response.status_code in (404, 410):
                unsubscribe(home, row["subscription"]["endpoint"], row["user_id"])
            log.warning("Mobile push delivery failed: HTTP %s (%s)",
                        exc.response.status_code if exc.response is not None else "no response",
                        type(exc).__name__)
        except Exception:
            log.exception("Mobile push delivery failed")
    return delivered


def notify_pending(home: Path, profile: str, kind: str, request_id: str) -> None:
    """Push first; the configured ntfy topic wakes the phone when Web Push cannot."""
    if send_pending(home, profile, kind, request_id):
        return
    from gateway.config import PlatformConfig
    from plugins.platforms.ntfy.adapter import _env_enablement, _standalone_send

    settings = _env_enablement()
    if not settings:
        return
    result = asyncio.run(_standalone_send(
        PlatformConfig(extra=settings), "", "Frodo needs you"))
    if not result.get("success"):
        log.warning("Mobile ntfy fallback delivery failed: %s", result.get("error", "unknown"))
