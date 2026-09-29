"""One searchable log line per background-process exit, correlating it with its owner.

The receipt under ``logs/process-results/`` stays the canonical record; this line exists so
``grep 'process.exit' agent.log`` finds the exit next to whatever else the owning Hermes
process logged at the time (a dashboard shutdown, a compression). It carries identifiers and
exit metadata only: never the command, environment, cwd, output, or gateway session key
(which can embed a chat/user id).

Only this module's observer reports a child's exit. It cannot know why the child's own parent
chain went away, so it never claims a parent disconnect; a host that saw its parent vanish
says so itself (``tui_gateway/exit_telemetry.py``).
"""

import logging
import os
import signal
import time

logger = logging.getLogger("tools.process_registry.lifecycle")

_UNSET = object()


def _signal_name(exit_code) -> str:
    """Popen reports death-by-signal as ``-signum``; anything else is a plain exit status."""
    if not isinstance(exit_code, int) or exit_code >= 0:
        return ""
    try:
        return signal.Signals(-exit_code).name
    except ValueError:
        return f"SIG{-exit_code}"


def _exit_fields(session) -> dict:
    with session._lock:
        return {
            "id": session.id,
            "pid": session.pid if session.pid is not None else "",
            "pid_scope": session.pid_scope,
            "owner_session": session.parent_session_id or "",
            "owner_task": session.owner_task_id or "",
            "exit_code": "" if session.exit_code is None else session.exit_code,
            "signal": _signal_name(session.exit_code),
            "reason": session.completion_reason,
            "source": session.termination_source or "",
        }


def record_process_exit(session) -> bool:
    """Log the session's exit once; log again only if the recorded outcome changed.

    A kill racing the reader thread first finalizes as a plain ``exited`` and is then
    rewritten as ``killed`` (the receipt is re-saved too). The second line carries
    ``revision=2`` so the last line for an id always matches the receipt, and a repeat call
    with unchanged fields writes nothing. Returns whether a line was written.
    """
    fields = _exit_fields(session)
    previous = getattr(session, "_exit_logged", _UNSET)
    if previous == fields:
        return False
    revision = getattr(session, "_exit_log_revision", 0) + 1
    session._exit_logged = fields
    session._exit_log_revision = revision
    runtime = time.time() - session.started_at if session.started_at else None
    logger.info(
        "process.exit %s observer_pid=%d runtime_s=%s revision=%d",
        " ".join(f"{k}={v}" for k, v in fields.items()),
        os.getpid(), "" if runtime is None else f"{runtime:.1f}", revision)
    return True
