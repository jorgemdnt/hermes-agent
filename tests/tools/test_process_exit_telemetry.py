"""Correlated exit telemetry for background processes and the Hermes hosts they may be.

Regression for the PID 62704 investigation: a QA worker's preview Uvicorn served the real
Hermes home, and another agent's compression was running inside it when the worker killed it
with ``process(action="kill")``. The receipt proved the kill, but nothing tied the dead
WebSocket and the reclaimed compression lock to it. These tests pin the two lines that do:
``process.exit`` (written by the killer's registry) and ``host.exit`` (written by the dying host),
joined on the OS PID.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from tools import process_registry_lifecycle
from tools.process_registry import ProcessRegistry, ProcessSession
from tui_gateway import entry, exit_telemetry

REPO_ROOT = Path(__file__).resolve().parents[2]
LIFECYCLE_LOGGER = "tools.process_registry.lifecycle"


def _fields(line: str, prefix: str) -> dict:
    assert line.startswith(prefix + " "), line
    return dict(re.findall(r"(\w+)=(\S*)", line[len(prefix):]))


def _exit_lines(caplog, prefix: str) -> list[dict]:
    return [_fields(r.getMessage(), prefix) for r in caplog.records if r.getMessage().startswith(prefix + " ")]


def _receipt(home, proc_id: str) -> dict:
    return json.loads((home / "logs" / "process-results" / f"{proc_id}.json").read_text())


def _adopt(registry: ProcessRegistry, argv: list[str], *, task_id: str, cwd, env=None) -> ProcessSession:
    """Spawn like the registry does (own session, merged stdout) and hand the child to it.
    ``adopt_local`` keeps the real reader/kill/receipt paths; only env building is skipped."""
    proc = subprocess.Popen(argv, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    return registry.adopt_local(proc, command=" ".join(argv), cwd=str(cwd), task_id=task_id,
                                owner_task_id=task_id, notify_on_complete=False)


def _wait_for(predicate, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def home(tmp_path, monkeypatch):
    hermes_home = tmp_path / "hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.setattr(exit_telemetry, "_recorded_cause", None)
    return hermes_home


@pytest.mark.platforms("posix")
def test_ordinary_exit_logs_once_and_matches_receipt_without_command_text(home, caplog):
    caplog.set_level(logging.INFO, logger=LIFECYCLE_LOGGER)
    registry = ProcessRegistry()
    session = _adopt(registry, ["sh", "-c", "exit 3 # secret-marker-9f2"], task_id="t-ordinary", cwd=home)
    assert session._completion_event.wait(30), "ordinary child never finished"

    lines = _exit_lines(caplog, "process.exit")
    assert len(lines) == 1, lines
    line, receipt = lines[0], _receipt(home, session.id)
    assert line["id"] == receipt["id"] == session.id
    assert line["pid"] == str(session.pid)
    assert line["exit_code"] == str(receipt["exit_code"]) == "3"
    assert line["reason"] == receipt["completion_reason"] == "exited"
    assert line["signal"] == "" and line["source"] == ""
    assert line["owner_task"] == "t-ordinary"
    # The observer only knows the child exited; it must not claim anything about a parent.
    assert "parent" not in caplog.text.replace("parent_session", "")
    assert "secret-marker-9f2" not in caplog.text
    assert str(home) not in caplog.text


_PREVIEW_HOST = textwrap.dedent("""
    import logging, sys
    import uvicorn
    from tui_gateway import server
    from tui_gateway.exit_telemetry import install_uvicorn_exit_telemetry

    logging.basicConfig(filename=sys.argv[1], level=logging.INFO, format="%(name)s %(message)s")

    class CompressingAgent:
        session_id = "sess-compressing-under-kill"
        _active_compression_lock_holder = "pid=1:tid=1:agent=0:nonce=test"

    server._sessions["ui-1"] = {"agent": CompressingAgent(), "session_key": "k", "running": True}

    async def app(scope, receive, send):
        if scope["type"] == "http":
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

    preview = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, lifespan="off", log_level="info"))
    install_uvicorn_exit_telemetry(preview)
    preview.run()
""")


@pytest.mark.platforms("posix")
def test_sigterm_of_preview_during_compression_correlates_kill_and_host_exit(home, tmp_path, caplog):
    """The killer's receipt/log and the preview's own host.exit line meet on the OS PID, and the
    host line names the compression the signal interrupted."""
    caplog.set_level(logging.INFO, logger=LIFECYCLE_LOGGER)
    script = tmp_path / "preview_host.py"
    script.write_text(_PREVIEW_HOST)
    host_log = tmp_path / "preview-agent.log"
    registry = ProcessRegistry()
    import os

    session = _adopt(registry, [sys.executable, str(script), str(host_log)], task_id="t-qa", cwd=tmp_path,
                     env={**os.environ, "HERMES_HOME": str(home), "PYTHONUNBUFFERED": "1",
                          "PYTHONPATH": str(REPO_ROOT)})
    try:
        assert _wait_for(lambda: "Uvicorn running on" in session.output_buffer, 60), session.output_buffer
        result = registry.kill_process(session.id)
    finally:
        if not session.exited:
            registry.kill_process(session.id)

    assert result["status"] == "killed", result
    receipt = _receipt(home, session.id)
    assert (receipt["exit_code"], receipt["completion_reason"], receipt["termination_source"]) == (
        -15, "killed", "process.kill")

    lines = _exit_lines(caplog, "process.exit")
    assert lines, "no process.exit line for the kill"
    last = lines[-1]  # the kill-race rewrite, if any, is the line that matches the receipt
    assert (last["exit_code"], last["reason"], last["source"], last["signal"]) == (
        "-15", "killed", "process.kill", "SIGTERM")

    host_lines = [ln.split(" ", 1)[1] for ln in host_log.read_text().splitlines()
                  if ln.startswith("tui_gateway.exit_telemetry host.exit ")]
    assert len(host_lines) == 1, host_log.read_text()
    host = _fields(host_lines[0], "host.exit")
    assert host["cause"] == "signal" and host["signal"] == "SIGTERM"
    assert host["pid"] == last["pid"] == str(session.pid)
    assert host["active_turns"] == "1"
    assert host["compressing"] == "sess-compressing-under-kill"


def test_kill_race_rewrite_logs_a_second_revision_and_repeats_are_silent(caplog):
    caplog.set_level(logging.INFO, logger=LIFECYCLE_LOGGER)
    session = ProcessSession(id="proc_race", command="serve", pid=4242, started_at=time.time(), exited=True)
    session.exit_code = 0
    assert process_registry_lifecycle.record_process_exit(session) is True
    assert process_registry_lifecycle.record_process_exit(session) is False
    session.exit_code, session.completion_reason, session.termination_source = -15, "killed", "process.kill"
    assert process_registry_lifecycle.record_process_exit(session) is True

    lines = _exit_lines(caplog, "process.exit")
    assert [(ln["reason"], ln["revision"]) for ln in lines] == [("exited", "1"), ("killed", "2")]


def test_host_exit_first_cause_wins(home, caplog):
    """uvicorn re-raises the captured SIGTERM into later handlers and then shuts down; the
    later paths must not log a second, conflicting cause."""
    caplog.set_level(logging.INFO, logger="tui_gateway.exit_telemetry")
    assert exit_telemetry.record_host_exit("signal", signum=15) is True
    assert exit_telemetry.record_host_exit("shutdown") is False
    lines = _exit_lines(caplog, "host.exit")
    assert [(ln["cause"], ln["signal"]) for ln in lines] == [("signal", "SIGTERM")]


def _run_entry_until_eof(monkeypatch, *, spurious_recoveries: int) -> None:
    import io

    monkeypatch.setattr(entry, "_install_sidecar_publisher", lambda: None)
    monkeypatch.setattr(entry.server, "_stdio_is_rpc_channel", False, raising=False)
    monkeypatch.setattr(entry, "ensure_mcp_discovery_started", lambda: None)
    monkeypatch.setattr(entry, "resolve_skin", lambda: "default")
    monkeypatch.setattr(entry.server, "_ensure_skin_watcher", lambda: None)
    monkeypatch.setattr(entry.server, "_start_backend_heartbeat_refresher", lambda: None)
    monkeypatch.setattr(entry.server, "_schedule_startup_orphan_sweep", lambda: None)
    monkeypatch.setattr(entry, "_log_exit", lambda reason: None)
    monkeypatch.setattr(entry, "write_json", lambda payload: True)
    monkeypatch.setattr(entry, "_recovery_times", [time.time()] * spurious_recoveries)
    monkeypatch.setattr(entry, "handle_spurious_eof", lambda times, log: False)
    monkeypatch.setattr(entry.sys, "stdin", io.StringIO(""))
    entry.main()


def test_stdin_eof_is_recorded_as_parent_disconnect(home, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="tui_gateway.exit_telemetry")
    _run_entry_until_eof(monkeypatch, spurious_recoveries=0)
    lines = _exit_lines(caplog, "host.exit")
    assert [(ln["cause"], ln["detail"], ln["signal"]) for ln in lines] == [
        ("parent_disconnect", "stdin_eof", "")]


def test_exhausted_spurious_eof_recovery_is_not_called_a_disconnect(home, monkeypatch, caplog):
    from tui_gateway._stdin_recovery import MAX_RECOVERIES_PER_MINUTE

    caplog.set_level(logging.INFO, logger="tui_gateway.exit_telemetry")
    _run_entry_until_eof(monkeypatch, spurious_recoveries=MAX_RECOVERIES_PER_MINUTE + 1)
    lines = _exit_lines(caplog, "host.exit")
    assert [ln["cause"] for ln in lines] == ["stdin_recovery_exhausted"]


@pytest.mark.platforms("posix")
def test_dead_desktop_parent_is_recorded_as_parent_disconnect(home, monkeypatch, caplog):
    import subprocess
    import threading

    from hermes_cli import web_server_lifecycle

    caplog.set_level(logging.INFO, logger="tui_gateway.exit_telemetry")
    gone = subprocess.Popen(["true"])
    gone.wait()
    exited = threading.Event()
    monkeypatch.setenv("HERMES_PARENT_PID", str(gone.pid))
    monkeypatch.delenv("HERMES_PARENT_START_MARKER", raising=False)
    monkeypatch.delenv("HERMES_PARENT_NONCE", raising=False)
    monkeypatch.setenv("HERMES_SERVE_WATCHDOG_POLL_S", "0.5")
    monkeypatch.setattr(web_server_lifecycle, "_request_orphan_shutdown", exited.set)
    web_server_lifecycle._start_parent_death_watchdog()
    assert exited.wait(10), "watchdog never fired for a dead parent"
    lines = _exit_lines(caplog, "host.exit")
    assert [(ln["cause"], ln["detail"]) for ln in lines] == [("parent_disconnect", "parent_pid_gone")]
