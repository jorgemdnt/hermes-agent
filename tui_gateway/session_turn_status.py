"""Project the shared turn lease onto a viewer's resume/activate snapshot.

The viewer never adopts the foreign writer's lease or sets its local run-loop
flag. CLI writers have no WS replay buffer; clients tail the existing REST
transcript while this flag is set. Server-owned turns keep normal event replay.
"""
from __future__ import annotations

from functools import wraps


def with_turn_status(handler):
    @wraps(handler)
    def wrapped(rid, params):
        import os
        import re
        from tui_gateway import server

        response = handler(rid, params)
        payload = response.get("result")
        if not isinstance(payload, dict):
            return response
        key = payload.get("session_key") or payload.get("stored_session_id") or payload.get("resumed")
        if not key:
            return response
        # Activate addresses a runtime id; its owning profile, not the launch
        # profile, decides which store contains the shared turn lease.
        session = server._sessions.get(str(payload.get("session_id") or ""), {})
        if session.get("running"):
            payload["external_turn"] = False
            return response
        try:
            with (server._session_db(session) if session else server._profile_db(params)) as db:
                if db is None:
                    return server._db_unavailable_error(rid, code=5000)
                if not callable(getattr(type(db), "get_session_turn_lease", None)):
                    return response
                owner = db.get_session_turn_lease(key)
        except Exception:
            server.logger.warning("Could not read shared turn status for %s", key, exc_info=True)
            return server._err(rid, 5000, "Could not check this turn. Reconnect and try again.")
        match = re.search(r"(?:^|:)pid=(\d+)(?::|$)", owner["holder"]) if owner else None
        external = bool(owner and (not match or int(match[1]) != os.getpid()))
        payload["external_turn"] = external
        if external and owner:
            payload.update(running=True, status="working", turn_started_at=owner["acquired_at"])
        return response

    return wrapped
