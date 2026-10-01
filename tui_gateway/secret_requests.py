"""Phone-only secret prompt bridge and response authority (no plaintext persistence)."""
from __future__ import annotations

import time
from pathlib import Path


def _session_for_tool(task_id: str):
    from tui_gateway import server
    with server._sessions_lock:
        return next(((sid, session) for sid, session in server._sessions.items()
                     if session.get("session_key") == task_id and session.get("source") == "mobile"), None)


def request_secret(task_id: str, name: str, reason: str, destination: dict, expires_in: int, *,
                   title: str | None = None, help_url: str | None = None, hint: str | None = None) -> tuple[str, str, str, str]:
    """The running mobile agent owns this session. The response supplies only a value."""
    from tui_gateway import server_requests
    from hermes_constants import get_hermes_home, get_process_hermes_home, profile_name_for_home
    hit = _session_for_tool(task_id)
    if hit is None:
        raise ValueError("secret_request needs a live mobile chat session")
    sid, session = hit
    home = Path(session.get("profile_home") or get_process_hermes_home())
    if home != get_hermes_home():
        raise ValueError("secret_request profile scope mismatch")
    receipt: dict = {}
    answer = server_requests.send("secret.request", sid, {
        "name": name, "reason": reason, "destination": destination,
        "requester": profile_name_for_home(home) or "Hermes",
        "expires_at": time.time() + expires_in,
        **{key: value for key, value in (("title", title), ("help_url", help_url), ("hint", hint)) if value is not None},
    }, timeout=expires_in, receipt=receipt)
    value = (answer or {}).get("value")
    return receipt.get("id", ""), value if isinstance(value, str) else "", receipt.get("sub", ""), task_id


def authorized_answer(req, transport) -> bool:
    """The socket must be an attached, still-authorized Google browser for this request's bot."""
    from tui_gateway import server
    from tui_gateway.ws import WSTransport
    from hermes_cli.dashboard_auth.local_logout import browser_epoch, browser_token_active
    from hermes_constants import get_process_hermes_home, set_hermes_home_override, reset_hermes_home_override
    if not isinstance(transport, WSTransport) or transport.closed:
        return False
    identity = transport.auth_identity or {}
    if identity.get("provider") != "self-hosted" or not identity.get("user_id") or not identity.get("browser_id") or not identity.get("access_digest"):
        return False
    if not isinstance(identity.get("session_expires_at"), (int, float)) or identity["session_expires_at"] <= time.time():
        return False
    if not isinstance(req.params.get("expires_at"), (int, float)) or req.params["expires_at"] <= time.time():
        return False
    with server._sessions_lock:
        session = server._sessions.get(req.sid)
    if (not session or session.get("source") != "mobile"
            or session.get("auth_user_id") != f"{identity['provider']}:{identity['user_id']}"
            or not getattr(server, "_session_transport_contains")(session, transport)):
        return False
    home = Path(session.get("profile_home") or get_process_hermes_home())
    if str(home) != req.owner_home:
        return False
    # The dashboard's Google allowlist belongs to the launch profile, not the
    # selected bot. A samwise session still authenticates against this dashboard.
    token = set_hermes_home_override(get_process_hermes_home())
    try:
        from hermes_cli.config import load_config
        cfg = load_config().get("dashboard", {}).get("oauth", {}).get("self_hosted", {})
        allowed = cfg.get("allowed_emails") or []
        return (isinstance(allowed, list) and isinstance(identity.get("email"), str)
                and identity["email"].casefold() in {str(email).casefold() for email in allowed}
                and isinstance(identity.get("browser_epoch"), int)
                and identity["browser_epoch"] == browser_epoch(identity["browser_id"])
                and browser_token_active(identity["access_digest"], identity["browser_id"]))
    finally:
        reset_hermes_home_override(token)
