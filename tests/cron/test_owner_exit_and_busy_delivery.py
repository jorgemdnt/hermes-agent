"""Live process/lock regressions for dead cron owners and busy Bot Chat delivery."""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import pytest

from cron import executions, jobs, scheduler, scheduler_delivery


def test_killed_owner_is_reconciled_by_history_and_next_tick_fires(tmp_path, monkeypatch, capsys):
    home = tmp_path / "home"
    monkeypatch.setenv("HERMES_HOME", str(home))
    job = jobs.create_job(prompt="Produce a test report", schedule="0 5 * * *", deliver="local")
    ready = tmp_path / "ready.json"
    child = """
import json, pathlib, sys
from cron.executions import mark_execution_running
from cron.scheduler_provider import InProcessCronScheduler
job = InProcessCronScheduler().claim_fire(sys.argv[1], manual=True)
record = mark_execution_running(job['execution_id'])
ready = pathlib.Path(sys.argv[2])
ready.with_suffix('.pending').write_text(json.dumps(record))
ready.with_suffix('.pending').replace(ready)
sys.stdin.read()
"""
    repo = Path(__file__).resolve().parents[2]
    env = {**os.environ, "PYTHONPATH": str(repo), "HERMES_HOME": str(home)}
    proc = subprocess.Popen([sys.executable, "-c", child, job["id"], str(ready)],
                            cwd=repo, env=env, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 30
        while not ready.exists() and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        assert ready.exists(), "owner did not claim the test job"
        record = json.loads(ready.read_text())
        assert record["status"] == "running"
        assert executions.get_execution(record["id"])["status"] == "running"
        with sqlite3.connect(home / "cron" / "executions.db") as conn:
            conn.execute("UPDATE executions SET claimed_at=? WHERE id=?",
                         ("2000-01-01T00:00:00+00:00", record["id"]))
        # History is diagnostic: even an old live owner must survive an explicit read.
        assert executions.list_executions(job_id=job["id"])[0]["status"] == "running"
        assert executions.latest_executions([job["id"]])[job["id"]]["status"] == "running"
        proc.kill()
        proc.wait(timeout=10)

        # The periodic scan is deliberately throttled; an explicit history read cannot lie
        # until it reopens, and must persist the same terminal classification as the ticker.
        monkeypatch.setattr(scheduler, "_last_dead_owner_reap_at", {
            scheduler.hermes_home_key(home): time.monotonic()})
        from hermes_cli.cron import cron_runs
        cron_runs(job["id"])
        output = capsys.readouterr().out
        assert record["id"] in output and "unknown" in output
        recovered = executions.get_execution(record["id"])
        assert executions.latest_executions([job["id"]])[job["id"]] == recovered
        assert recovered["finished_at"] and "owner exited" in recovered["error"]
        assert jobs.get_job(job["id"])["next_run_at"] == job["next_run_at"]

        due = datetime.fromisoformat(job["next_run_at"])
        for module in (jobs, scheduler, executions):
            monkeypatch.setattr(module, "_hermes_now", lambda: due)
        monkeypatch.setattr(scheduler, "_should_yield_tick_to_fresh_gateway", lambda: None)
        monkeypatch.setattr(scheduler, "_maybe_run_worktree_maintenance", lambda: None)
        monkeypatch.setattr(scheduler, "_sweep_mcp_orphans", lambda: None)
        monkeypatch.setattr(scheduler, "run_job", lambda *a, **kw: (True, "test report", "test report", None))
        assert scheduler.tick(verbose=False) == 1
        history = executions.list_executions(job_id=job["id"])
        assert {row["status"] for row in history} == {"unknown", "completed"}
        assert len(history) == 2
        assert not any(row["status"] in ("claimed", "running") for row in history)
        assert datetime.fromisoformat(jobs.get_job(job["id"])["next_run_at"]) > due
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.communicate(timeout=10)


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("profile", ["", "ops"])
def test_busy_cron_fallback_refuses_without_spawning_and_holds_the_shared_lock(
    tmp_path, monkeypatch, profile,
):
    from tools.bot_relay import TurnBusyError, acquire_turn_lock

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    root = tmp_path / ".hermes"
    home = root / "profiles" / profile if profile else root
    home.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(root))
    calls = []

    def run_turn(*args):
        with pytest.raises(TurnBusyError):
            with acquire_turn_lock(root, profile or "default", timeout_seconds=0):
                pass
        calls.append(args)
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(scheduler_delivery, "_run_bot_chat_turn", run_turn)
    job = {"id": "digest", "execution_id": "busy-run"}
    with acquire_turn_lock(root, profile or "default", timeout_seconds=0):
        started = time.monotonic()
        error = scheduler_delivery._deliver_to_bot_chat(job, "saved output", profile)
        assert time.monotonic() - started < 5
        assert error and "target_busy" in error and "not sent" in error
        assert calls == []
    assert scheduler_delivery._deliver_to_bot_chat(job, "saved output", profile) is None
    assert len(calls) == 1
    with acquire_turn_lock(root, profile or "default", timeout_seconds=0):
        pass


def test_required_tool_failure_remains_failed_and_sends_a_short_notice(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    job = jobs.create_job(prompt="Collect Sentry data", schedule="0 5 * * *", deliver="bot-chat")
    detail = "Sentry search_events returned HTTP 429; required report could not be verified."
    monkeypatch.setattr(scheduler, "run_job", lambda *a, **kw: (
        True, "Full diagnostic output", f"[CRON_FAILURE]\n{detail}", None))
    delivered = []
    monkeypatch.setattr(scheduler, "_deliver_result", lambda job, content, **kw: delivered.append((content, kw)))

    assert scheduler.run_one_job(job)
    record = executions.latest_execution(job["id"])
    stored = jobs.get_job(job["id"])
    assert record["status"] == "failed" and record["error"] == detail
    assert record["delivery_outcome"] == "delivered"
    assert stored["last_status"] == "error" and stored["failure_streak"] == 1
    assert stored["last_error"] == detail and stored["last_delivery_error"] is None
    assert len(delivered) == 1
    notice, kwargs = delivered[0]
    assert kwargs["for_failure"] is True
    assert "HTTP 429" in notice and len(notice) < 1500
    assert "[CRON_FAILURE]" not in notice
