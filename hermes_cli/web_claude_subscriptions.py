"""Dashboard adapter for official Claude Code account login; no OAuth code or token passes here."""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
from threading import Lock, Timer
from typing import Any, cast

from fastapi import APIRouter, HTTPException
from providers import get_provider_profile

router = APIRouter()
_logins: dict[str, dict] = {}
_lock = Lock()


def _profile() -> Any:
    profile = cast(Any, get_provider_profile("claude-subscription-directsdk-experimental"))
    if not callable(getattr(profile, "start_subscription_login", None)):
        raise HTTPException(503, "Claude Code subscription provider unavailable")
    return profile


def _stop(login: dict, *, discard: bool) -> None:
    process = login["process"]
    if process.poll() is None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGTERM)
            else:
                process.terminate()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=3)
    if discard:
        shutil.rmtree(login["dir"], ignore_errors=True)


def _expire(session_id: str) -> None:
    with _lock:
        login = _logins.pop(session_id, None)
    if login is not None:
        _stop(login, discard=True)


@router.post("/api/subscriptions/claude/login")
def start_claude_login():
    # The official CLI opens the default browser. Never run a Hermes/Anthropic OAuth flow.
    login = _profile().start_subscription_login()
    with _lock:
        _logins[login["id"]] = login
    timer = Timer(300, _expire, args=(login["id"],))
    timer.daemon = True
    timer.start()
    return {"session_id": login["id"], "status": "pending"}


@router.get("/api/subscriptions/claude/login/{session_id}")
def poll_claude_login(session_id: str):
    with _lock:
        login = _logins.get(session_id)
        if login is None:
            raise HTTPException(404, "Login not found")
        status = _profile().finish_subscription_login(login)
        if status != "pending":
            _logins.pop(session_id, None)
    if status != "pending":
        _stop(login, discard=status != "approved")
    return {"status": status}


@router.delete("/api/subscriptions/claude/login/{session_id}")
def cancel_claude_login(session_id: str):
    with _lock:
        login = _logins.pop(session_id, None)
    if login is None:
        raise HTTPException(404, "Login not found")
    _stop(login, discard=True)
    return {"ok": True}


@router.delete("/api/subscriptions/claude/accounts/{account_id}")
def remove_claude_account(account_id: str):
    removed = _profile().remove_subscription_account(account_id)
    if not removed:
        raise HTTPException(404, "Account not found")
    return {"ok": True}
