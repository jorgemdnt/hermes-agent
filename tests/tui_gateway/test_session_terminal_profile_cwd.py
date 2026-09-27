"""A Desktop session's terminal starts under its own profile, not the serve process's cwd."""

from pathlib import Path

import tui_gateway.server as server
from tools import terminal_tool as tt


def test_remote_session_cwd_follows_profile_a_b_a(tmp_path, monkeypatch):
    launch = tmp_path / "launch"
    remote_home = tmp_path / "remote"
    launch_cwd = tmp_path / "local-work"
    for directory in (launch, remote_home, launch_cwd):
        directory.mkdir()
    remote_cwd = "/home/hermes/work/artemis"
    (launch / "config.yaml").write_text(
        f"terminal:\n  backend: local\n  cwd: {launch_cwd}\n", encoding="utf-8")
    (remote_home / "config.yaml").write_text(
        f"terminal:\n  backend: ssh\n  cwd: {remote_cwd}\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setenv("TERMINAL_ENV", "local")
    monkeypatch.setenv("TERMINAL_CWD", "/Users/launch-user")
    session = {"session_key": "profile-cwd-probe", "cwd": str(launch_cwd)}
    try:
        for home, backend, cwd in (
            (launch, "local", str(launch_cwd)),
            (remote_home, "ssh", remote_cwd),
            (launch, "local", str(launch_cwd)),
        ):
            session["profile_home"] = str(home)
            server._register_session_cwd(session)  # session.create registers outside the turn's profile scope
            assert tt._task_env_overrides[session["session_key"]]["cwd"] == cwd
            with server._session_profile_runtime_scope(session, hydrate_secrets=False):
                assert server._effective_terminal_backend() == backend
                assert tt._get_env_config()["cwd"] == cwd
                if backend == "ssh":
                    assert not Path(remote_cwd).exists()  # never validate an SSH cwd on the Mac
                    assert server._display_session_cwd(session) == str(launch_cwd)
            assert tt._task_env_overrides[session["session_key"]]["cwd"] == cwd
            if backend == "ssh":
                remote_session = {"profile_home": str(remote_home), "cwd": remote_cwd}
                assert server._display_session_cwd(remote_session) == remote_cwd
                assert server._reconcile_session_cwd_from_terminal(remote_session) is False
        assert server._terminal_task_cwd({"cwd": str(launch_cwd)}) == str(launch_cwd)
    finally:
        tt.clear_task_env_overrides(session["session_key"])


def test_local_session_explicit_workspace_still_wins(tmp_path, monkeypatch):
    launch, local_home, configured, chosen = (tmp_path / name for name in ("launch", "local", "configured", "chosen"))
    for directory in (launch, local_home, configured, chosen):
        directory.mkdir()
    (local_home / "config.yaml").write_text(
        f"terminal:\n  backend: local\n  cwd: {configured}\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setenv("TERMINAL_ENV", "ssh")  # launch profile must not change a local profile's behavior
    monkeypatch.setenv("TERMINAL_CWD", "/Users/launch-user")
    session = {"profile_home": str(local_home), "cwd": str(chosen), "explicit_cwd": True}
    with server._session_profile_runtime_scope(session, hydrate_secrets=False):
        assert server._effective_terminal_backend() == "local"
        assert server._terminal_task_cwd_with_source(session) == (str(chosen), "session")
        assert server._display_session_cwd(session) == str(chosen)
