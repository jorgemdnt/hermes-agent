"""Session cwd is host-local metadata, never a remote profile's inherited launch dir."""

from argparse import Namespace
from contextlib import ExitStack
import os
import sqlite3

from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from hermes_state import SessionDB
from tools.terminal_scope import install_and_reset_profile_terminal_scope


def _homes(tmp_path):
    homes = {}
    for backend in ("local", "ssh"):
        home = tmp_path / backend
        home.mkdir()
        (home / "config.yaml").write_text(
            f"terminal:\n  backend: {backend}\n  cwd: /remote/workspace\n",
            encoding="utf-8",
        )
        homes[backend] = home
    return homes


def test_resume_preserves_remote_host_cwd_and_restores_local(tmp_path, monkeypatch, capsys):
    import hermes_state
    from hermes_cli.cli_session_mixin import CLISessionMixin
    from hermes_cli.main import _resolve_chat_session_args
    from run_agent import _launch_cwd_for_session

    homes = _homes(tmp_path)
    saved, sender = tmp_path / "saved", tmp_path / "sender"
    saved.mkdir()
    sender.mkdir()
    monkeypatch.setenv("TERMINAL_ENV", "local")  # The multiplexer/sender's policy is not the recipient's.
    monkeypatch.chdir(sender)
    for backend in ("ssh", "local", "ssh"):
        home = homes[backend]
        monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", home / "state.db")
        with SessionDB(db_path=home / "state.db") as db:
            db.create_session("chat", "cli")
        # Simulate a legacy row poisoned by a sender's host cwd.
        with sqlite3.connect(home / "state.db") as conn:
            conn.execute("UPDATE sessions SET cwd = ? WHERE id = 'chat'", (str(saved),))
        token = set_hermes_home_override(home)
        try:
            # Startup resumes run before the CLI's config-to-env bridge.
            args = Namespace(resume="chat", continue_last=None, in_dir=None,
                             no_restore_cwd=False, worktree=False)
            monkeypatch.chdir(sender)
            _resolve_chat_session_args(args, use_tui=False)
            expected = saved if backend == "local" else sender
            assert os.getcwd() == str(expected)
            assert ("restored workspace dir" in capsys.readouterr().out) == (backend == "local")

            with install_and_reset_profile_terminal_scope(home):
                assert _launch_cwd_for_session("cli") == (str(expected) if backend == "local" else None)
                monkeypatch.chdir(sender)
                monkeypatch.setenv("TERMINAL_CWD", "/remote/workspace")
                CLISessionMixin()._restore_session_cwd({"cwd": str(saved)}, quiet=True)
                assert os.getcwd() == str(expected)
                assert os.environ["TERMINAL_CWD"] == (str(saved) if backend == "local" else "/remote/workspace")
        finally:
            reset_hermes_home_override(token)
            monkeypatch.chdir(sender)


def test_all_session_writers_follow_the_store_owner_not_the_launch_profile(tmp_path, monkeypatch):
    homes = _homes(tmp_path)
    monkeypatch.setenv("TERMINAL_ENV", "local")
    with ExitStack() as stack:
        stores = {backend: stack.enter_context(SessionDB(db_path=home / "state.db"))
                  for backend, home in homes.items()}
        # A -> B -> A under one process; each scope writes into BOTH stores.
        for iteration, active in enumerate(("local", "ssh", "local")):
            token = set_hermes_home_override(homes[active])
            try:
                with install_and_reset_profile_terminal_scope(homes[active]):
                    for backend, db in stores.items():
                        expected = "/host/sender" if backend == "local" else None
                        for source in ("cli", "oneshot", "tui", "desktop", "kanban", "acp"):
                            sid = f"{iteration}-{source}"
                            db.create_session(sid, source, cwd="/host/sender", git_repo_root="/host/repo",
                                              model_config={"cwd": "/host/sender"})
                            assert db.get_session(sid)["cwd"] == expected
                            if backend == "ssh":
                                with sqlite3.connect(db.db_path) as conn:
                                    conn.execute(
                                        "UPDATE sessions SET cwd = ?, git_branch = ?, git_repo_root = ? WHERE id = ?",
                                        ("/host/legacy", "main", "/host/repo", sid),
                                    )
                            db.ensure_session(sid, source, cwd="/host/other")
                            assert db.get_session(sid)["cwd"] == expected
                            generation = db.update_session_cwd(sid, "/host/sender", "main", "/host/repo")
                            assert db.get_session(sid)["cwd"] == expected
                            if backend == "ssh":
                                assert generation is None
                                assert db.get_session(sid)["git_repo_root"] is None
                            db.create_session(sid + "-branch", source, parent_session_id=sid)
                            assert db.get_session(sid + "-branch")["cwd"] == expected
                        parent = f"{iteration}-parent"
                        child = f"{iteration}-compression"
                        db.create_session(parent, "cli", cwd="/host/sender")
                        db.publish_compression_child(
                            parent_session_id=parent, child_session_id=child, source="cli",
                            messages=[{"role": "user", "content": "continue"}],
                            cwd="/host/sender", require_compression_lease=False,
                        )
                        assert db.get_session(child)["cwd"] == expected
                        db.backfill_acp_session_cwd()
                        assert db.get_session(f"{iteration}-acp")["cwd"] == expected
            finally:
                reset_hermes_home_override(token)
