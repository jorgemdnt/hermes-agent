"""Only exact, one-to-one historical evidence may identify a worker transcript."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb, kanban_db_connect as kbc
from hermes_cli.kanban_db_sessions import backfill_run_sessions
from hermes_state import SessionDB


@pytest.fixture
def board(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    os_home = tmp_path / "os-home"
    os_home.mkdir()
    monkeypatch.setenv("HOME", str(os_home))
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: os_home)
    path = home / "board.db"
    with kbc.connect_closing(path) as conn:
        yield home, path, conn


def _run(conn, task_id="t_first", *, title="Exact card", profile="coder", start=100, end=200,
         status="done", session_id=None):
    conn.execute(
        "INSERT OR IGNORE INTO tasks (id, title, status, created_at, session_id) "
        "VALUES (?, ?, 'done', 1, 'origin-conversation')", (task_id, title),
    )
    return conn.execute(
        "INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, session_id) "
        "VALUES (?, ?, ?, ?, ?, ?)", (task_id, profile, status, start, end, session_id),
    ).lastrowid


def _session(home, session_id="worker", *, profile="coder", source="kanban", title="Exact card",
             start=150.5, parent=None, legacy_titles=False):
    profile_home = home if profile == "default" else home / "profiles" / profile
    profile_home.mkdir(parents=True, exist_ok=True)
    with_db = SessionDB(db_path=profile_home / "state.db")
    try:
        with_db.create_session(session_id=session_id, source=source, parent_session_id=parent)
        if legacy_titles:
            # Pre-unique-title stores can contain multiple literal matches.
            with_db._conn.execute("DROP INDEX idx_sessions_title_unique")
        # Test timestamps are deliberately unrelated to wall clock; titles are
        # literal evidence, without invoking the title store's #N uniquification.
        with_db._conn.execute("UPDATE sessions SET title = ?, started_at = ? WHERE id = ?", (title, start, session_id))
        with_db._conn.commit()
    finally:
        with_db.close()
    return profile_home / "state.db"


@pytest.mark.parametrize("legacy_pk", [False, True], ids=["additive", "text-pk-rebuild"])
def test_run_session_migration_preserves_origin_and_is_idempotent(board, legacy_pk):
    home, path, conn = board
    run_id = _run(conn)
    conn.execute("ALTER TABLE task_runs DROP COLUMN session_id")
    if legacy_pk:
        conn.executescript(
            "ALTER TABLE task_runs RENAME TO old_runs; "
            "CREATE TABLE task_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, profile TEXT, "
            "status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER); "
            "INSERT INTO task_runs SELECT 'legacy-run', task_id, profile, status, started_at, ended_at FROM old_runs; "
            "DROP TABLE old_runs;"
        )
    _session(home)
    for _ in range(2):
        kbc.init_db(path)
        with kbc.connect_closing(path) as reopened:
            columns = {r["name"]: r for r in reopened.execute("PRAGMA table_info(task_runs)")}
            assert columns["session_id"]["type"] == "TEXT"
            runs = kb.list_runs(reopened, "t_first")
            assert len(runs) == 1
            assert runs[0].session_id == "worker"
            assert kb.get_run(reopened, runs[0].id).session_id == "worker"
            assert kb.latest_run(reopened, "t_first").session_id == "worker"
            assert kb.get_task(reopened, "t_first").session_id == "origin-conversation"
            assert backfill_run_sessions(reopened) == 0


@pytest.mark.parametrize("case", [
    "exact", "default-profile", "active", "terminal-second", "wrong-source", "wrong-title",
    "before", "after", "wrong-profile", "missing-state", "corrupt-state", "no-profile",
    "remote-profile", "two-sessions", "duplicate-run", "overlapping-card", "reserved",
    "already-linked", "compression-child", "nonrunning-open", "sequential-runs",
])
def test_backfill_only_one_to_one_local_profile_evidence(board, case):
    home, path, conn = board
    profile = "default" if case == "default-profile" else "coder"
    if case == "no-profile":
        profile = None
    if case == "remote-profile":
        profile = "vps:coder"
    run_id = _run(conn, profile=profile, end=None if case in {"active", "nonrunning-open"} else 200,
                  status="running" if case == "active" else "done",
                  session_id="durable-id" if case == "already-linked" else None)
    state_path = _session(
        home, profile="default" if case in {"wrong-profile", "default-profile"} else "coder",
        source="cli" if case == "wrong-source" else "kanban",
        title="Unrelated card" if case == "wrong-title" else "Exact card",
        start={"before": 99.9, "after": 201.0, "terminal-second": 200.9}.get(case, 150.5),
    )
    # Reassignment of the card does not change the historical run's store.
    conn.execute("UPDATE tasks SET assignee = 'default'")
    if case == "missing-state":
        state_path.unlink()
    if case == "corrupt-state":
        state_path.write_bytes(b"not sqlite")
    if case == "two-sessions":
        _session(home, "second-worker", legacy_titles=True)
    if case == "duplicate-run":
        _run(conn)
    if case == "overlapping-card":
        _run(conn, "t_other")
    if case == "reserved":
        _run(conn, "t_other", start=1, end=2, session_id="worker")
    if case == "compression-child":
        _session(home, "parent", title="Different", start=1)
        with sqlite3.connect(state_path) as state:
            state.execute("UPDATE sessions SET parent_session_id = 'parent' WHERE id = 'worker'")
    if case == "sequential-runs":
        second_run = _run(conn, start=300, end=400)
        _session(home, "second-worker", start=350, legacy_titles=True)
    expected = case in {"exact", "default-profile", "active", "terminal-second", "sequential-runs"}
    before_bytes = state_path.read_bytes() if state_path.exists() else None
    assert backfill_run_sessions(conn, task_id="t_first") == (2 if case == "sequential-runs" else int(expected))
    assert kb.get_run(conn, run_id).session_id == ("durable-id" if case == "already-linked" else "worker" if expected else None)
    if case == "sequential-runs":
        assert kb.get_run(conn, second_run).session_id == "second-worker"
    assert backfill_run_sessions(conn) == 0
    assert kb.get_task(conn, "t_first").session_id == "origin-conversation"
    if before_bytes is None:
        assert not state_path.exists()
    else:
        assert state_path.read_bytes() == before_bytes


def test_backfill_uses_real_truncated_and_retry_title_projection(board):
    from agent.title_generator import kanban_session_title, _persist_session_title

    home, _, conn = board
    title = 'A long card title with whitespace ' * 6
    first = _run(conn, title=title)
    second = _run(conn, title=title, start=300, end=400)
    target = home / 'profiles/coder'
    target.mkdir(parents=True)
    with SessionDB(target / 'state.db') as db:
        for sid, start in [('first', 150), ('retry', 350)]:
            db.create_session(sid, 'kanban')
            _persist_session_title(db, sid, kanban_session_title(title), source='llm')
            db._conn.execute('UPDATE sessions SET started_at=? WHERE id=?', (start, sid))
            db._conn.commit()
        assert db.get_session_title('retry').endswith(' #2')
    assert backfill_run_sessions(conn) == 2
    assert kb.get_run(conn, first).session_id == 'first'
    assert kb.get_run(conn, second).session_id == 'retry'

