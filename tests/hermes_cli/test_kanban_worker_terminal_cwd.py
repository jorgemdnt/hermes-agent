"""Kanban's host-side workspace must not override the assignee's remote terminal cwd.

Local workers still pin TERMINAL_CWD to the workspace for relative file writes
(#41312) and context-file discovery (#34619). Remote workers use their own
profile policy; the subprocess cwd and HERMES_KANBAN_WORKSPACE remain host paths.
"""

from __future__ import annotations

import subprocess

import pytest


def _make_task(kb, *, assignee: str = "w"):
    return kb.Task(
        id="t_cwd",
        title="cwd pin",
        body=None,
        assignee=assignee,
        status="running",
        priority=0,
        created_by="test",
        created_at=1,
        started_at=None,
        completed_at=None,
        workspace_kind="dir",
        workspace_path=None,
        claim_lock="lock",
        claim_expires=None,
        tenant=None,
        current_run_id=1,
    )


def _capture_spawn_env(kb, monkeypatch, workspace: str) -> dict:
    from hermes_cli import kanban_db_dispatch as kbd

    monkeypatch.setattr(kbd, "_resolve_hermes_argv", lambda: ["hermes"])

    captured: dict = {}

    class FakeProc:
        pid = 4242

    def fake_popen(cmd, *args, **kwargs):
        captured["cmd"] = list(cmd)
        captured["env"] = dict(kwargs.get("env") or {})
        captured["cwd"] = kwargs.get("cwd")
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    kbd._default_spawn(_make_task(kb), workspace)
    return captured


def test_terminal_cwd_pinned_to_workspace(monkeypatch, tmp_path):
    """A real, absolute workspace dir is pinned as TERMINAL_CWD."""
    root = tmp_path / ".hermes"
    (root / "profiles" / "w").mkdir(parents=True)
    (root / "profiles" / "w" / "config.yaml").write_text("toolsets:\n  - kanban\n", encoding="utf-8")
    root.joinpath("config.yaml").write_text("toolsets:\n  - kanban\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(root))

    from hermes_cli import kanban_db as kb

    workspace = tmp_path / "ws"
    workspace.mkdir()

    captured = _capture_spawn_env(kb, monkeypatch, str(workspace))

    assert captured["env"]["TERMINAL_CWD"] == str(workspace)
    # The subprocess cwd and TERMINAL_CWD must agree — both anchor the workspace.
    assert captured["cwd"] == str(workspace)
    assert captured["env"]["HERMES_KANBAN_WORKSPACE"] == str(workspace)


@pytest.mark.parametrize(("backend", "profile_cwd", "expected"), [
    ("ssh", "/home/hermes/work/artemis", "/home/hermes/work/artemis"),
    ("ssh", "", "~"),
    ("local", "", "workspace"),
])
def test_worker_shell_cwd_follows_assigned_backend(
    monkeypatch, tmp_path, backend, profile_cwd, expected,
):
    from hermes_cli import kanban_db as kb
    from tools import terminal_tool as tt

    root = tmp_path / ".hermes"
    profile = root / "profiles" / "w"
    profile.mkdir(parents=True)
    (profile / "config.yaml").write_text(
        f"terminal:\n  backend: {backend}\n"
        + (f"  cwd: {profile_cwd}\n" if profile_cwd else ""),
        encoding="utf-8",
    )
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setenv("TERMINAL_CWD", str(tmp_path / "dispatcher-cwd"))
    workspace = tmp_path / "mac-workspace"
    workspace.mkdir()

    spawned = _capture_spawn_env(kb, monkeypatch, str(workspace))
    env = spawned["env"]
    expected_cwd = str(workspace) if expected == "workspace" else expected
    assert spawned["cwd"] == env["HERMES_KANBAN_WORKSPACE"] == str(workspace)
    if profile_cwd or backend == "local":
        assert env["TERMINAL_CWD"] == expected_cwd
    else:
        assert "TERMINAL_CWD" not in env

    # Resolve with the actual worker's environment/config, not a mocked ssh
    # transport. This is the cwd the fresh terminal shell will be passed.
    with monkeypatch.context() as child:
        for key, value in env.items():
            if key in {"HERMES_HOME", "TERMINAL_CWD", "TERMINAL_ENV"}:
                child.setenv(key, value)
        if "TERMINAL_CWD" not in env:
            child.delenv("TERMINAL_CWD", raising=False)
        child.setattr(tt, "_terminal_config_bridge_attempted", False)
        config = tt._get_env_config()
        assert config["env_type"] == backend
        assert config["cwd"] == expected_cwd


