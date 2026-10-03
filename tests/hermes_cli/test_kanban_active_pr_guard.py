"""Only a card's explicitly published, still-open PR suppresses redispatch."""
from __future__ import annotations

import subprocess
from unittest.mock import ANY, Mock

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc
from hermes_cli import kanban_db_dispatch as kbd
from hermes_cli import kanban_pr_acceptance as acceptance

PR = "https://github.com/example/repo/pull/44"
OTHER_PR = "https://github.com/other/repo/pull/99"


@pytest.fixture
def board(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("HERMES_RUNTIME_DIR", str(tmp_path / "runtime"))
    monkeypatch.setattr("hermes_cli.profiles.profile_exists", lambda name: True)
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: {})
    monkeypatch.setattr(acceptance, "_assignee_profile_home", lambda name: f"/profiles/{name}")
    kb.init_db()
    with kbc.connect() as conn:
        yield conn


def publish_metadata(conn, tid, value=PR, age=0):
    claimed = kb.claim_task(conn, tid)
    assert claimed is not None
    assert kb.request_review(
        conn, tid, summary="PR ready", metadata={"published_pr": value},
        expected_run_id=claimed.current_run_id,
    )
    with kb.write_txn(conn):
        conn.execute("UPDATE tasks SET status='ready' WHERE id=?", (tid,))
        conn.execute("UPDATE task_runs SET ended_at=ended_at-? WHERE task_id=?", (age, tid))


@pytest.mark.parametrize("source", ["contract", "metadata"])
@pytest.mark.parametrize("state,merged", [("open", False), ("closed", True), ("closed", False)])
def test_guard_tracks_own_pr_state(board, monkeypatch, source, state, merged):
    api = Mock(return_value={"state": state, "merged": merged})
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(
        board, title="own PR", assignee="dev",
        completion_contract=PR if source == "contract" else "local-only",
    )
    if source == "metadata":
        publish_metadata(board, tid)
    # Even a fresh link cannot keep a merged/closed PR active.
    kb.add_comment(board, tid, author="dev", body=f"Published {PR}")
    result = kbd.dispatch_once(board, dry_run=True)
    assert dict(result.respawn_guarded).get(tid) == ("active_pr" if state == "open" else None)
    assert (tid in [s[0] for s in result.spawned]) is (state != "open")
    api.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/dev", timeout=ANY)


def test_someone_elses_comment_pr_does_not_block_or_query_github(board, monkeypatch):
    api = Mock(side_effect=AssertionError("A comment is not PR ownership"))
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="unrelated follow-up", assignee="dev")
    kb.add_comment(board, tid, author="reviewer", body=f"See {OTHER_PR}")
    result = kbd.dispatch_once(board, dry_run=True)
    assert tid in [s[0] for s in result.spawned]
    assert tid not in dict(result.respawn_guarded)
    api.assert_not_called()


def test_comment_cannot_substitute_for_merged_own_pr(board, monkeypatch):
    api = Mock(return_value={"state": "closed", "merged": True})
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="own merged PR", assignee="dev", completion_contract=PR)
    kb.add_comment(board, tid, author="reviewer", body=f"Another open PR: {OTHER_PR}")
    assert kbd.check_respawn_guard(board, tid) is None
    api.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/dev", timeout=ANY)


def test_old_metadata_still_guards_an_open_pr_after_newer_run(board, monkeypatch):
    monkeypatch.setattr(acceptance, "_api", Mock(return_value={"state": "open", "merged": False}))
    tid = kb.create_task(board, title="still open", assignee="dev")
    publish_metadata(board, tid, age=172800)
    claimed = kb.claim_task(board, tid)
    assert claimed is not None
    assert kb.block_task(board, tid, reason="temporary failure", expected_run_id=claimed.current_run_id)
    assert kb.unblock_task(board, tid)
    assert kbd.check_respawn_guard(board, tid) == "active_pr"


@pytest.mark.parametrize("value", [None, 44, PR + "/files", OTHER_PR])
def test_repo_contract_rejects_unrelated_or_invalid_metadata(board, monkeypatch, value):
    api = Mock(side_effect=AssertionError("No owned PR"))
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="publish here", assignee="dev", completion_contract="example/repo")
    publish_metadata(board, tid, value=value)
    assert kbd.check_respawn_guard(board, tid) is None
    api.assert_not_called()


def test_exact_contract_wins_over_other_metadata(board, monkeypatch):
    api = Mock(return_value={"state": "closed", "merged": True})
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="bound PR", assignee="dev", completion_contract=PR)
    publish_metadata(board, tid, value=OTHER_PR)
    assert kbd.check_respawn_guard(board, tid) is None
    api.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/dev", timeout=ANY)


@pytest.mark.parametrize("error", [subprocess.TimeoutExpired("gh", 30), acceptance._GateAuthError("HTTP 403")])
def test_unavailable_github_is_not_evidence_of_an_open_pr(board, monkeypatch, error):
    api = Mock(side_effect=error)
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="unknown state", assignee="dev", completion_contract=PR)
    assert kbd.check_respawn_guard(board, tid) is None
    api.side_effect = None
    api.return_value = {"state": "open", "merged": False}
    assert kbd.check_respawn_guard(board, tid) == "active_pr"


def test_github_read_is_outside_write_transaction(board, monkeypatch):
    def api(endpoint, **kwargs):
        assert not board.in_transaction
        assert endpoint == "repos/example/repo/pulls/44"
        return {"state": "open", "merged": False}
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="no DB lock during network", assignee="dev", completion_contract=PR)
    assert kbd.check_respawn_guard(board, tid) == "active_pr"


def test_pr_state_is_reread_after_merge(board, monkeypatch):
    api = Mock(side_effect=[{"state": "open", "merged": False}, {"state": "closed", "merged": True}])
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="merge lifts guard", assignee="dev", completion_contract=PR)
    assert kbd.check_respawn_guard(board, tid) == "active_pr"
    assert kbd.check_respawn_guard(board, tid) is None


def test_repo_contract_accepts_own_publication_metadata(board, monkeypatch):
    api = Mock(return_value={"state": "open", "merged": False})
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="correct repo", assignee="dev", completion_contract="example/repo")
    publish_metadata(board, tid)
    assert kbd.check_respawn_guard(board, tid) == "active_pr"
    api.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/dev", timeout=ANY)


def test_failed_acceptance_binding_is_newer_than_an_earlier_handoff(board, monkeypatch):
    tid = kb.create_task(board, title="late publication", assignee="dev", completion_contract="example/repo")
    with kb.write_txn(board):
        board.execute("UPDATE tasks SET created_at=created_at-120 WHERE id=?", (tid,))
    assert kb.assign_task(board, tid, "closer")
    with kb.write_txn(board):
        board.execute("UPDATE task_events SET created_at=created_at-60 WHERE task_id=?", (tid,))
    monkeypatch.setattr(acceptance, "_api", Mock(side_effect=subprocess.TimeoutExpired("gh", 30)))
    assert not kb.complete_task(board, tid, summary="published", metadata={"published_pr": PR})
    task = kb.get_task(board, tid)
    assert task is not None and task.completion_contract == PR
    # Operator recovered the failed acceptance read; isolate the PR guard.
    with kb.write_txn(board):
        board.execute("UPDATE tasks SET last_failure_error=NULL WHERE id=?", (tid,))
    api = Mock(return_value={"state": "open", "merged": False})
    monkeypatch.setattr(acceptance, "_api", api)
    assert kbd.check_respawn_guard(board, tid) == "active_pr"
    api.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/closer", timeout=ANY)


def test_native_review_reopen_resumes_same_owner_without_a_fake_block(board, monkeypatch):
    monkeypatch.setattr(acceptance, "_api", Mock(return_value={"state": "open", "merged": False}))
    tid = kb.create_task(board, title="resume same PR", assignee="dev")
    publish_metadata(board, tid, age=60)
    assert kbd.check_respawn_guard(board, tid) == "active_pr"
    assert kb.request_review(board, tid, summary="Continue this PR")
    assert kb.reopen_review_task(board, tid)
    assert kbd.check_respawn_guard(board, tid) is None
    result = kbd.dispatch_once(board, dry_run=True)
    assert tid in [s[0] for s in result.spawned]
    task = kb.get_task(board, tid)
    assert task is not None
    assert task.assignee == "dev"
    assert task.block_recurrences == 0
    assert not [event for event in kb.list_events(board, tid) if event.kind in {"blocked", "block_loop_detected"}]


def test_failed_acceptance_of_exact_contract_preserves_earlier_handoff(board, monkeypatch):
    tid = kb.create_task(board, title="known PR", assignee="dev", completion_contract=PR)
    with kb.write_txn(board):
        board.execute("UPDATE tasks SET created_at=created_at-120 WHERE id=?", (tid,))
    assert kb.assign_task(board, tid, "closer")
    with kb.write_txn(board):
        board.execute("UPDATE task_events SET created_at=created_at-60 WHERE task_id=?", (tid,))
    monkeypatch.setattr(acceptance, "_api", Mock(side_effect=subprocess.TimeoutExpired("gh", 30)))
    assert not kb.complete_task(board, tid, summary="check pending", metadata={"published_pr": PR})
    with kb.write_txn(board):
        board.execute("UPDATE tasks SET last_failure_error=NULL WHERE id=?", (tid,))
    api = Mock(return_value={"state": "open", "merged": False})
    monkeypatch.setattr(acceptance, "_api", api)
    assert kbd.check_respawn_guard(board, tid) is None
    api.assert_not_called()


@pytest.mark.parametrize("dry_run", [True, False])
def test_default_assignment_uses_effective_profile_for_github(board, monkeypatch, dry_run):
    def api(endpoint, *, profile_home, timeout):
        if profile_home != "/profiles/dev":
            raise acceptance._GateAuthError("No ambient access to private PR")
        return {"state": "open", "merged": False}
    read = Mock(side_effect=api)
    monkeypatch.setattr(acceptance, "_api", read)
    tid = kb.create_task(board, title="private PR", completion_contract=PR)
    result = kbd.dispatch_once(board, dry_run=dry_run, default_assignee="dev")
    assert dict(result.respawn_guarded).get(tid) == "active_pr"
    assert not result.spawned
    read.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/dev", timeout=ANY)
    task = kb.get_task(board, tid)
    assert task is not None and task.assignee == (None if dry_run else "dev")


def test_review_lane_does_not_query_github(board, monkeypatch):
    api = Mock(side_effect=AssertionError("Review handoff must still run"))
    monkeypatch.setattr(acceptance, "_api", api)
    tid = kb.create_task(board, title="review me", assignee="dev", completion_contract=PR)
    assert kbd.check_respawn_guard(board, tid, lane="review") is None
    api.assert_not_called()


def test_dispatch_bounds_pr_reads_and_still_dispatches_unrelated_work(board, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(kbd.time, "monotonic", lambda: clock[0])

    def api(endpoint, *, profile_home, timeout):
        assert timeout == pytest.approx(5.0)
        clock[0] += timeout
        return {"state": "open", "merged": False}

    read = Mock(side_effect=api)
    monkeypatch.setattr(acceptance, "_api", read)
    own_open = kb.create_task(board, title="slow open PR", assignee="dev", completion_contract=PR, priority=10)
    unknown = kb.create_task(board, title="budget exhausted", assignee="dev", completion_contract=OTHER_PR)
    unrelated = kb.create_task(board, title="no PR ownership", assignee="dev")
    for _ in range(2):
        result = kbd.dispatch_once(board, dry_run=True)
        assert dict(result.respawn_guarded) == {own_open: "active_pr"}
        assert {s[0] for s in result.spawned} == {unknown, unrelated}
    assert read.call_count == 2


def test_guard_passes_only_remaining_tick_budget_to_github(board, monkeypatch):
    monkeypatch.setattr(kbd.time, "monotonic", lambda: 100.0)
    read = Mock(return_value={"state": "open", "merged": False})
    monkeypatch.setattr(acceptance, "_api", read)
    tid = kb.create_task(board, title="remaining budget", assignee="dev", completion_contract=PR)
    assert kbd.check_respawn_guard(board, tid, pr_check_deadline=100.5) == "active_pr"
    read.assert_called_once_with("repos/example/repo/pulls/44", profile_home="/profiles/dev", timeout=0.5)
    read.reset_mock()
    assert kbd.check_respawn_guard(board, tid, pr_check_deadline=100.0) is None
    read.assert_not_called()


def test_is_open_pr_bounds_the_github_subprocess(monkeypatch):
    monkeypatch.setattr(acceptance, "_assignee_profile_home", lambda name: None)
    run = Mock(return_value=subprocess.CompletedProcess([], 0, '{"state":"open","merged":false}'))
    monkeypatch.setattr(acceptance.subprocess, "run", run)
    assert acceptance.is_open_pr(PR)
    assert run.call_args.kwargs["timeout"] == 5.0
