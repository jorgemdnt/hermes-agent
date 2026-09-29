"""One searchable ``host.exit`` line per Hermes host process (dashboard/serve or stdio gateway).

It records why the host is going away and what it was doing, so a later reader can join a
dead WebSocket or a reclaimed compression lock to a cause instead of guessing:

    host.exit cause=signal signal=SIGTERM pid=62704 ppid=... active_turns=1
        compressing=20260828_210147_af9806 running_processes=proc_5a95d1a5eff4

Causes are observations, never inferences:

- ``signal``: a termination signal reached this process (the sender is unknown here; the
  sender's own ``process.exit`` receipt names it when a Hermes registry killed us).
- ``parent_disconnect``: this process saw its parent go away — the Desktop parent PID died,
  or the stdio peer closed our stdin.
- ``stdin_recovery_exhausted``: stdin kept reading as spurious EOF past the recovery cap;
  the parent may still be alive.
- ``shutdown``: an orderly stop with no captured signal.

The first cause wins. Later exit paths of the same process (uvicorn re-raising the captured
SIGTERM into the chained flush handler, atexit) do not write a second, conflicting line.

Identifiers only: session ids, process ids, counts. No prompts, commands, env or paths.
"""

from __future__ import annotations

import logging
import os
import signal
import threading

logger = logging.getLogger("tui_gateway.exit_telemetry")

_lock = threading.Lock()
_recorded_cause: str | None = None


def _signal_name(signum) -> str:
    try:
        return signal.Signals(int(signum)).name
    except (TypeError, ValueError):
        return f"SIG{signum}"


def _activity_snapshot() -> dict:
    """Turns, compressions and background processes live in THIS process right now.

    Reads only this process's own session table. A signal handler may run while another
    thread holds the session lock, so the acquire is bounded and a miss says so instead of
    blocking shutdown.
    """
    from tui_gateway import server

    from tools.process_registry import process_registry

    snapshot = {"active_turns": "unavailable", "compressing": "unavailable", "running_processes": "unavailable"}
    if server._sessions_lock.acquire(timeout=0.5):
        try:
            sessions = [s for s in server._sessions.values() if isinstance(s, dict)]
        finally:
            server._sessions_lock.release()
        snapshot["active_turns"] = str(sum(1 for s in sessions if s.get("running")))
        snapshot["compressing"] = ",".join(sorted(
            str(getattr(agent, "session_id", "") or "?") for s in sessions
            if getattr(agent := s.get("agent"), "_active_compression_lock_holder", None)))
    if process_registry._lock.acquire(timeout=0.5):
        try:
            snapshot["running_processes"] = ",".join(sorted(process_registry._running))
        finally:
            process_registry._lock.release()
    return snapshot


def record_host_exit(cause: str, *, signum: int | None = None, detail: str = "") -> bool:
    """Log this host's exit cause once. Returns False when an earlier path already recorded one.
    ``detail`` names the observation behind the cause (``stdin_eof``, ``parent_pid_gone``, ...)."""
    global _recorded_cause
    with _lock:
        if _recorded_cause is not None:
            logger.debug("host.exit already recorded as %s; ignoring %s", _recorded_cause, cause)
            return False
        _recorded_cause = cause
    try:
        activity = _activity_snapshot()
    except Exception:
        logger.debug("host.exit activity snapshot failed", exc_info=True)
        activity = dict.fromkeys(("active_turns", "compressing", "running_processes"), "unavailable")
    fields = {
        "cause": cause,
        "signal": _signal_name(signum) if signum is not None else "",
        "detail": detail,
        "pid": os.getpid(),
        "ppid": os.getppid(),
        **activity,
    }
    # An orderly stop is routine; every other cause belongs in errors.log too.
    level = logging.INFO if cause == "shutdown" else logging.WARNING
    logger.log(level, "host.exit %s", " ".join(f"{k}={v}" for k, v in fields.items()))
    return True


def install_uvicorn_exit_telemetry(server) -> None:
    """Record the signal the moment uvicorn catches it, while turns and compressions are still
    live. Must run before ``server.capture_signals()``, which binds ``server.handle_exit``."""
    handle_exit = server.handle_exit

    def _handle_exit(sig, frame) -> None:
        record_host_exit("signal", signum=sig)
        handle_exit(sig, frame)

    server.handle_exit = _handle_exit


def drain_before_hard_exit() -> None:
    """``os._exit`` skips the queued log listener's atexit drain; flush the exit line first."""
    try:
        from hermes_logging import drain_log_queue

        drain_log_queue(timeout=0.5)
    except Exception:
        pass
