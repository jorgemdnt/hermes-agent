"""PR references are not publications; only the card's worker can guard a retry."""
import json
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc
from hermes_cli import kanban_db_dispatch as kbd
from hermes_cli import kanban_pr_acceptance as acceptance


PR = "https://github.com/example/repo/pull/44"


@pytest.fixture
def board(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(kbd, "_profile_exists_fn", lambda: lambda name: True)
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: {"kanban": {"review_dispatch": False}})
    kb.init_db()
    with kbc.connect() as conn:
        yield conn


def crash(conn, tid):
    assert not kbd._record_task_failure(
        conn, tid, "worker exited", outcome="crashed", release_claim=True,
        end_run=True, failure_limit=10,
    )
    assert kb.get_task(conn, tid).status == "ready"


@pytest.mark.parametrize("origin", ["operator", "tool", "cli", "cross-tool", "cross-cli", "cron-tool", "cron-cli"])
def test_same_profile_orchestrator_pr_reference_does_not_guard_worker_retry(board, monkeypatch, origin):
    from hermes_cli import kanban
    from tools import kanban_tools as kt
    from tools.registry import registry

    tid = kb.create_task(board, title="build on another PR", assignee="default")
    claimed = kb.claim_task(board, tid)
    assert claimed is not None
    if origin.startswith("cron-"):
        monkeypatch.setenv("HERMES_KANBAN_TASK", tid)
        monkeypatch.setenv("HERMES_KANBAN_RUN_ID", str(claimed.current_run_id))
    # The orchestrator and claimed worker have the same name. An active claim
    # alone cannot turn the orchestrator's comment into the worker's publication.
    if origin.startswith("cross-"):
        other = kb.create_task(board, title="another worker", assignee="default")
        other_run = kb.claim_task(board, other)
        assert kb.complete_task(board, other, summary="finished")
        monkeypatch.setenv("HERMES_KANBAN_TASK", other)
        monkeypatch.setenv("HERMES_KANBAN_RUN_ID", str(other_run.current_run_id))
    from agent.delegation_context import non_dispatcher_owned_context
    body = f"Build on {PR}"
    with non_dispatcher_owned_context() if origin.startswith("cron-") else nullcontext():
        if origin == "operator":
            kb.add_comment(board, tid, author="default", body=body)
        elif origin.endswith("tool"):
            assert json.loads(registry.dispatch("kanban_comment", {"task_id": tid, "body": body}))["ok"]
        else:
            assert kanban._cmd_comment(SimpleNamespace(task_id=tid, text=[body], max_len=None,
                                                      author="default")) == 0
    commented = [e for e in kb.list_events(board, tid) if e.kind == "commented"]
    assert commented[-1].run_id is None
    crash(board, tid)
    # A departed worker cannot attach publication evidence to a later retry.
    with pytest.raises(ValueError, match="worker no longer owns the current run"):
        kb.add_comment(board, tid, "default", f"Opened {PR}",
                       expected_run_id=claimed.current_run_id)
    assert len(kb.list_comments(board, tid)) == 1
    reads = []
    monkeypatch.setattr(acceptance, "_api", lambda *a, **kw: reads.append(a))
    spawned = []
    result = kbd.dispatch_once(board, spawn_fn=lambda task, workspace: spawned.append(task.id))
    assert not result.respawn_guarded
    assert spawned == [tid]
    assert kb.get_task(board, tid).status == "running"
    assert reads == [], "Reference PRs must not even trigger GitHub reads"


@pytest.mark.parametrize("publication", ["metadata", "tool", "cli"])
@pytest.mark.parametrize("cooldown", ["normal", "elapsed", "disabled"])
def test_worker_publication_guards_once_until_github_closes_it(board, monkeypatch, publication, cooldown):
    tid = kb.create_task(board, title="publish then crash", assignee="default")
    claimed = kb.claim_task(board, tid)
    run_id = claimed.current_run_id
    if publication != "metadata":
        monkeypatch.setenv("HERMES_KANBAN_TASK", tid)
        monkeypatch.setenv("HERMES_KANBAN_RUN_ID", str(run_id))
        if publication == "tool":
            from tools import kanban_tools as kt
            from tools.registry import registry
            out = json.loads(registry.dispatch("kanban_comment",
                {"task_id": tid, "body": f"Opened {PR}"}))
            assert out["ok"], out
        else:
            from hermes_cli import kanban
            assert kanban._cmd_comment(SimpleNamespace(
                task_id=tid, text=[f"Opened {PR}"], max_len=None, author="default")) == 0
        monkeypatch.delenv("HERMES_KANBAN_TASK")
        monkeypatch.delenv("HERMES_KANBAN_RUN_ID")
    crash(board, tid)
    if publication == "metadata":
        # Crash bookkeeping can itself carry the publication handoff.
        with kb.write_txn(board):
            board.execute("UPDATE task_runs SET metadata=? WHERE id=?",
                          (json.dumps({"published_pr": PR}), run_id))
    if cooldown != "normal":
        monkeypatch.setenv("HERMES_KANBAN_RATE_LIMIT_COOLDOWN_SECONDS", "0" if cooldown == "disabled" else "300")
        with kb.write_txn(board):
            board.execute("UPDATE task_runs SET outcome='rate_limited', ended_at=ended_at-301 WHERE id=?", (run_id,))
            board.execute("UPDATE tasks SET last_failure_error='rate limit exceeded' WHERE id=?", (tid,))
    reads = []
    state = {"state": "open", "merged": False}

    def github(endpoint, **kwargs):
        reads.append(endpoint)
        return dict(state)

    monkeypatch.setattr(acceptance, "_api", github)
    spawned = []
    spawn = lambda task, workspace: spawned.append(task.id)
    dry = kbd.dispatch_once(board, spawn_fn=spawn, dry_run=True)
    assert dict(dry.respawn_guarded) == {tid: "active_pr"}
    assert not [e for e in kb.list_events(board, tid) if e.kind == "guarded"]
    for _ in range(3):
        result = kbd.dispatch_once(board, spawn_fn=spawn)
        assert dict(result.respawn_guarded) == {tid: "active_pr"}
        # Unrelated operator chatter must not make every tick log the guard again.
        kb.add_comment(board, tid, author="default", body="Still waiting on review")
    guarded = [e for e in kb.list_events(board, tid) if e.kind == "guarded"]
    assert len(guarded) == 1
    assert guarded[0].payload == {"reason": "active_pr", "pr_url": PR}
    assert guarded[0].run_id == run_id
    assert reads and set(reads) == {"repos/example/repo/pulls/44"}
    assert not spawned

    # An API failure or incomplete response is not evidence that the PR closed.
    def unavailable(endpoint, **kwargs):
        raise acceptance._GateAuthError("HTTP 403")

    monkeypatch.setattr(acceptance, "_api", unavailable)
    for _ in range(2):
        result = kbd.dispatch_once(board, spawn_fn=spawn)
        assert dict(result.respawn_guarded) == {tid: "pr_state_unavailable"}
    guarded = [e for e in kb.list_events(board, tid) if e.kind == "guarded"]
    assert len(guarded) == 2
    assert guarded[-1].payload == {"reason": "pr_state_unavailable", "pr_url": PR}
    assert guarded[-1].run_id == run_id
    monkeypatch.setattr(acceptance, "_api", github)
    state.clear()
    result = kbd.dispatch_once(board, spawn_fn=spawn)
    assert dict(result.respawn_guarded) == {tid: "pr_state_unavailable"}
    assert len([e for e in kb.list_events(board, tid) if e.kind == "guarded"]) == 2

    # Both merged and closed-without-merge PRs release the same card immediately.
    for merged in (True, False):
        state.update(state="closed", merged=merged)
        result = kbd.dispatch_once(board, spawn_fn=spawn)
        assert not result.respawn_guarded
        assert spawned[-1] == tid
        assert kb.get_task(board, tid).status == "running"
        crash(board, tid)
