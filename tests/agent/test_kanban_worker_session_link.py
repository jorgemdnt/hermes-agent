"""The actual CLI-created worker session is pinned, without stealing another claim."""
from __future__ import annotations

import sqlite3
from contextlib import nullcontext
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb, kanban_db_connect as kbc
from hermes_cli import kanban_db_sessions as links
from hermes_state import SessionDB


@pytest.fixture
def worker_home(tmp_path, monkeypatch):
    root = tmp_path / ".hermes"
    root.mkdir()
    os_home = tmp_path / "os-home"
    os_home.mkdir()
    monkeypatch.setenv("HOME", str(os_home))
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(Path, "home", lambda: os_home)
    monkeypatch.setenv("HERMES_SESSION_SOURCE", "kanban")
    monkeypatch.setenv("HERMES_KANBAN_DB", str(root / "board.db"))
    return root


def _claim(path, profile="default"):
    with kbc.connect_closing(path) as conn:
        task_id = kb.create_task(conn, title=f"Work for {profile}", assignee=profile,
                                 initial_status="blocked", workspace_kind="scratch")
        conn.execute("UPDATE tasks SET session_id = 'origin' WHERE id = ?", (task_id,))
        assert kb.unblock_task(conn, task_id)
        task = kb.claim_task(conn, task_id)
        assert task is not None
        return task


def _pins(monkeypatch, task):
    monkeypatch.setenv("HERMES_KANBAN_TASK", task.id)
    monkeypatch.setenv("HERMES_KANBAN_RUN_ID", str(task.current_run_id))
    monkeypatch.setenv("HERMES_KANBAN_CLAIM_LOCK", task.claim_lock)


def _agent(db):
    from hermes_cli.cli_init_mixin import CLIInitMixin
    from run_agent import AIAgent

    class Runtime(CLIInitMixin):
        def _init_session_store(self):
            self._session_db = db

        def _init_ui_state(self):
            pass

    # Exercise the real CLI startup's id generator, then the real agent row create
    # used by chat -q, without credentials, a model request, or user-state probes.
    cli = Runtime()
    cli._init_runtime_state(resume=None)
    agent = AIAgent.__new__(AIAgent)
    agent.session_id = cli.session_id
    agent.platform = "cli"
    agent.model = "test/model"
    agent._session_db = db
    agent._session_db_created = False
    agent._parent_session_id = None
    agent._session_init_model_config = {}
    agent._cached_system_prompt = "worker test"
    return agent


def test_worker_session_is_durable_across_profile_scope_and_terminal_transition(worker_home, monkeypatch):
    from agent.secret_scope import is_multiplex_active, set_multiplex_active
    from agent.title_generator import maybe_auto_title
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    root = worker_home
    path = root / "board.db"
    previous = is_multiplex_active()
    set_multiplex_active(True)
    try:
        for profile in ("alpha", "beta", "alpha"):
            home = root / "profiles" / profile
            home.mkdir(parents=True, exist_ok=True)
            token = set_hermes_home_override(str(home))
            try:
                task = _claim(path, profile)
                _pins(monkeypatch, task)
                db = SessionDB(db_path=home / "state.db")
                try:
                    agent = _agent(db)
                    assert db.get_session(agent.session_id) is None
                    with kbc.connect_closing(path) as conn:
                        assert kb.get_run(conn, task.current_run_id).session_id is None
                    agent._ensure_db_session()
                    assert db.get_session(agent.session_id)["source"] == "kanban"
                    maybe_auto_title(db, agent.session_id, f"work kanban task {task.id}")
                    assert db.get_session_title(agent.session_id).startswith(task.title)
                    db.append_message(agent.session_id, role="user", content=f"work kanban task {task.id}")
                    db.append_message(agent.session_id, role="assistant", content="worker transcript")
                    with kbc.connect_closing(path) as conn:
                        run = kb.get_run(conn, task.current_run_id)
                        assert run.session_id == agent.session_id
                        assert run.profile == profile
                        assert kb.block_task(conn, task.id, reason="human decision", expected_run_id=run.id)
                    with kbc.connect_closing(path) as conn:
                        assert kb.get_run(conn, task.current_run_id).session_id == agent.session_id
                        assert kb.get_task(conn, task.id).session_id == "origin"
                    assert db.get_messages(agent.session_id)[-1]["content"] == "worker transcript"
                finally:
                    db.close()
            finally:
                reset_hermes_home_override(token)
    finally:
        set_multiplex_active(previous)


@pytest.mark.parametrize("case", [
    "wrong-run", "wrong-task", "wrong-lock", "wrong-source", "delegate", "nonowner",
    "compression-child", "already-linked", "malformed-run", "missing-db", "reclaimed",
    "link-retry", "store-retry",
])
def test_session_creation_cannot_link_unowned_or_replaced_run(worker_home, monkeypatch, case):
    from agent.delegation_context import delegated_child_context, non_dispatcher_owned_context

    path = worker_home / "board.db"
    task = _claim(path)
    _pins(monkeypatch, task)
    db = SessionDB(db_path=worker_home / "state.db")
    try:
        agent = _agent(db)
        if case == "wrong-run":
            monkeypatch.setenv("HERMES_KANBAN_RUN_ID", str(task.current_run_id + 1))
        if case == "wrong-task":
            monkeypatch.setenv("HERMES_KANBAN_TASK", "t_other")
        if case == "wrong-lock":
            monkeypatch.setenv("HERMES_KANBAN_CLAIM_LOCK", "not-this-claim")
        if case == "wrong-source":
            monkeypatch.setenv("HERMES_SESSION_SOURCE", "cli")
        if case == "malformed-run":
            monkeypatch.setenv("HERMES_KANBAN_RUN_ID", "0" + str(task.current_run_id))
        if case == "missing-db":
            monkeypatch.setenv("HERMES_KANBAN_DB", str(worker_home / "missing" / "board.db"))
        if case == "compression-child":
            db.create_session("parent", source="kanban")
            agent._parent_session_id = "parent"
        if case == "already-linked":
            with kbc.connect_closing(path) as conn:
                assert links.link_run_session(conn, task.id, task.current_run_id, "original-worker", claim_lock=task.claim_lock)
        if case == "reclaimed":
            with kbc.connect_closing(path) as conn:
                kb.reclaim_task(conn, task.id)
                kb.claim_task(conn, task.id)
        if case == "link-retry":
            real_link = links.link_run_session
            calls = []

            def flaky(*args, **kwargs):
                calls.append(1)
                if len(calls) == 1:
                    raise sqlite3.OperationalError("database is locked")
                return real_link(*args, **kwargs)

            monkeypatch.setattr(links, "link_run_session", flaky)
        if case == "store-retry":
            real_create = db.create_session
            monkeypatch.setattr(db, "create_session", lambda **kwargs: (_ for _ in ()).throw(sqlite3.OperationalError("locked")))
        scope = {"delegate": delegated_child_context, "nonowner": non_dispatcher_owned_context}.get(case, nullcontext)
        with scope():
            agent._ensure_db_session()
        with kbc.connect_closing(path) as conn:
            assert kb.get_run(conn, task.current_run_id).session_id == ("original-worker" if case == "already-linked" else None)
        if case in {"link-retry", "store-retry"}:
            if case == "store-retry":
                assert db.get_session(agent.session_id) is None
                monkeypatch.setattr(db, "create_session", real_create)
            agent._ensure_db_session()
            agent._ensure_db_session()
            with kbc.connect_closing(path) as conn:
                assert kb.get_run(conn, task.current_run_id).session_id == agent.session_id
        if case == "missing-db":
            assert not (worker_home / "missing").exists()
    finally:
        db.close()
