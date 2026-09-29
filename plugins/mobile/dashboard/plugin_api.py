"""Mobile dashboard API, mounted by the regular authenticated plugin API loader."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from hermes_constants import get_process_hermes_home, profile_name_for_home
from hermes_cli.dashboard_auth.cookies import read_session_browser_id
from plugins.mobile import push
from tui_gateway import server_requests

router = APIRouter()
_home = Path(get_process_hermes_home())


class Subscription(BaseModel):
    endpoint: str
    keys: dict[str, str]


class Endpoint(BaseModel):
    endpoint: str


def _user(request: Request) -> str:
    session = getattr(request.state, "session", None)
    if session is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return session.user_id


@router.get("/push/key")
def key(request: Request):
    _user(request)
    return {"public_key": push.public_key(_home)}


@router.post("/push/subscriptions")
def subscribe(request: Request, body: Subscription):
    user = _user(request)
    browser_id = read_session_browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=401, detail="Browser session required")
    try:
        push.subscribe(_home, body.model_dump(), user, browser_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.delete("/push/subscriptions")
def unsubscribe(request: Request, body: Endpoint):
    push.unsubscribe(_home, body.endpoint, _user(request))
    return {"ok": True}


def _on_parked(sid: str, kind: str, request_id: str) -> None:
    # server_requests already retains this question for session.resume. Only alert when
    # the owning session has no attached answering renderer; never send prompt details.
    from agent.memory_provider import spawn_context_thread
    from tui_gateway import server
    from tui_gateway.session_transports import _session_live_transports

    session = server._sessions.get(sid)
    if not session or session.get("transport") is server._stdio_transport or _session_live_transports(session):
        return
    profile = profile_name_for_home(session.get("profile_home")) or "default"
    spawn_context_thread(target=push.notify_pending, name="mobile-push", args=(_home, profile, kind, request_id)).start()


server_requests.register_parked_hook(_on_parked)
