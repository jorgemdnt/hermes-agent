"""Open a visible Desktop session and hand it a prompt.

The dashboard token stays inside this module. Callers get ids only.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional


class HandoffError(RuntimeError):
    """The desktop serve could not take the prompt."""


@dataclass(frozen=True)
class DesktopServe:
    port: int
    token: str


def listening_port(connections: Iterable[Any]) -> Optional[int]:
    """First 127.0.0.1 TCP listen port, or None."""
    for conn in connections:
        if getattr(conn, "status", None) != "LISTEN":
            continue
        address = getattr(conn, "laddr", None)
        ip = getattr(address, "ip", None) or (address[0] if address else None)
        port = getattr(address, "port", None) or (address[1] if address else None)
        if ip in {"127.0.0.1", "::1"} and port:
            return int(port)
    return None


def find_desktop_serve(processes: Iterable[Any], *, home: str) -> Optional[DesktopServe]:
    """The Desktop ``hermes serve`` for ``home``. Env identity, not argv."""
    wanted = os.path.realpath(home)
    found: list[DesktopServe] = []
    for proc in processes:
        try:
            env = proc.environ()
            connections = proc.net_connections(kind="tcp")
        except Exception:
            continue
        if env.get("HERMES_DESKTOP") != "1":
            continue
        token = env.get("HERMES_DASHBOARD_SESSION_TOKEN") or ""
        if not token:
            continue
        if os.path.realpath(env.get("HERMES_HOME") or "") != wanted:
            continue
        port = listening_port(connections)
        if port:
            found.append(DesktopServe(port=port, token=token))
    if len(found) != 1:
        return None
    return found[0]


def session_link(session_id: str, profile: str = "") -> str:
    """Token Desktop renders as a click. Same shape as session search.

    ``custom`` is not a profile the app can route, so it is omitted.
    """
    name = (profile or "").strip()
    if name == "custom":
        name = ""
    if name:
        return f"@session:{name}/{session_id}"
    return f"@session:{session_id}"


def visible_prompt(prompt: str) -> str:
    """The brief the person sees. A stay-here paragraph is not part of it."""
    body = prompt or ""
    while body.lstrip().startswith("You are the Desktop session"):
        rest = body.lstrip().split("\n\n", 1)
        body = rest[1] if len(rest) > 1 else ""
    return body


def session_prompt(prompt: str) -> str:
    """Back-compat name. Does not prepend a stay-here paragraph."""
    return visible_prompt(prompt)


def leaf_dir(home: str):
    from pathlib import Path

    return Path(home) / "cache" / "handoff-leaves"


def mark_leaf(home: str, *session_ids: Optional[str]) -> None:
    """Remember a session that was handed a brief, so it cannot hand off again."""
    root = leaf_dir(home)
    root.mkdir(parents=True, exist_ok=True)
    for session_id in session_ids:
        if session_id:
            (root / str(session_id)).touch()


def is_leaf(home: str, session_id: str) -> bool:
    if not session_id:
        return False
    return (leaf_dir(home) / str(session_id)).is_file()


def run_handoff(
    serve: DesktopServe,
    *,
    title: str,
    prompt: str,
    cwd: str,
    resume: Optional[str],
    rpc: Callable[[DesktopServe, str, dict], dict],
    profile: str = "",
) -> dict:
    """Create or resume a visible session and submit ``prompt``. Ids only."""
    if resume:
        resumed = rpc(serve, "session.resume", {"session_id": resume})
        if "error" in resumed:
            raise HandoffError("session.resume failed")
        result = resumed.get("result") or {}
        session_id = result.get("session_id") or resume
        stored = result.get("stored_session_id") or resume
    else:
        created = rpc(
            serve,
            "session.create",
            {"title": title, "hidden": False, "source": "desktop", "cwd": cwd},
        )
        if "error" in created:
            raise HandoffError("session.create failed")
        result = created.get("result") or {}
        session_id = result.get("session_id")
        stored = result.get("stored_session_id") or session_id
        if not session_id:
            raise HandoffError("session.create returned no id")
    submitted = rpc(
        serve,
        "prompt.submit",
        {"session_id": session_id, "text": visible_prompt(prompt), "title_preview": title},
    )
    if "error" in submitted:
        raise HandoffError("prompt.submit failed")
    if not stored:
        raise HandoffError("handoff returned no stored id")
    return {
        "session_id": session_id,
        "stored_session_id": stored,
        "title": title,
        "link": session_link(str(stored), profile),
    }


def public_result(payload: dict) -> str:
    """JSON the CLI may print. Refuses a token-shaped field."""
    banned = {"token", "url"}
    if banned & set(payload):
        raise HandoffError("handoff result must not carry the serve credential")
    return json.dumps(payload)


def _ws_rpc(serve: DesktopServe, method: str, params: dict) -> dict:
    import time

    from websockets.sync.client import connect

    url = f"ws://127.0.0.1:{serve.port}/api/ws?token={serve.token}"
    origin = f"http://127.0.0.1:{serve.port}"
    with connect(url, open_timeout=15, max_size=None, additional_headers={"Origin": origin}) as ws:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            frame = json.loads(ws.recv(timeout=max(0.05, deadline - time.monotonic())))
            if frame.get("method") == "event":
                break
        rid = f"h{time.time_ns()}"
        ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            frame = json.loads(ws.recv(timeout=max(0.05, deadline - time.monotonic())))
            if frame.get("id") == rid:
                return frame
    raise HandoffError(f"{method} timed out")


def cmd_handoff(args) -> int:
    """CLI entry. Prints ids. Never prints the serve token."""
    import psutil

    from hermes_cli.profiles import get_active_profile_name
    from hermes_constants import get_hermes_home

    prompt = getattr(args, "prompt", None) or ""
    prompt_file = getattr(args, "prompt_file", None)
    if prompt_file:
        with open(prompt_file, encoding="utf-8") as handle:
            prompt = handle.read()
    if not prompt.strip():
        print("handoff needs a prompt (--prompt or --prompt-file)")
        return 1
    home = str(get_hermes_home())
    current = os.environ.get("HERMES_SESSION_ID") or os.environ.get("HERMES_SESSION_KEY") or ""
    if is_leaf(home, current):
        print("This session was handed a brief. Do the work here.")
        return 1
    title = getattr(args, "title", None) or "Desktop session"
    cwd = getattr(args, "cwd", None) or os.getcwd()
    serve = find_desktop_serve(psutil.process_iter(), home=home)
    if serve is None:
        print("No single Desktop serve for this profile. Open Hermes and retry.")
        return 1
    try:
        result = run_handoff(
            serve,
            title=title,
            prompt=prompt,
            cwd=cwd,
            resume=getattr(args, "resume", None),
            rpc=_ws_rpc,
            profile=get_active_profile_name(),
        )
    except HandoffError as exc:
        print(str(exc))
        return 1
    mark_leaf(home, result.get("session_id"), result.get("stored_session_id"))
    print(public_result(result))
    return 0
