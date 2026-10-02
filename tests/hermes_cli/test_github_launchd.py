"""Launchd PATH must not hide GitHub, or silently park a published card."""
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path

import pytest

from hermes_cli import github_api, kanban_db as kb, kanban_db_dispatch as dispatch
from hermes_cli.kanban_db_connect import connect
from hermes_platform.resolver import known_dirs


MINIMAL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
PR = "https://github.com/example/repo/pull/44"


@pytest.fixture
def service(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("PATH", MINIMAL_PATH)
    for key in ("GITHUB_TOKEN", "GH_TOKEN", "GH_CONFIG_DIR"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(github_api, "_gh_cli_cache", None)
    monkeypatch.setattr(github_api, "_gh_cli_probed", False)
    monkeypatch.setattr(dispatch, "_profile_exists_fn", lambda: lambda name: True)
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: {"kanban": {"review_dispatch": False}})
    kb.init_db()
    with connect() as conn:
        tid = kb.create_task(conn, title="published card", assignee="default")
        claimed = kb.claim_task(conn, tid)
        dispatch._record_task_failure(conn, tid, "worker exited", outcome="crashed",
                                     release_claim=True, end_run=True, failure_limit=10)
        with kb.write_txn(conn):
            conn.execute("UPDATE task_runs SET metadata=? WHERE id=?",
                         (json.dumps({"published_pr": PR}), claimed.current_run_id))
        yield conn, tid


def install_gh(directory, state_file):
    directory.mkdir(parents=True)
    gh = directory / "gh"
    gh.write_text(
        f"#!{sys.executable}\nimport json, sys\n"
        "if sys.argv[1:3] == ['auth', 'token']:\n"
        " print('test-only-token')\n"
        "else:\n"
        f" state = json.load(open({str(state_file)!r}))\n"
        " if 'exit' in state:\n"
        "  print(state['stderr'], file=sys.stderr)\n"
        "  sys.exit(state['exit'])\n"
        " print(state if isinstance(state, str) else json.dumps(state))\n",
        encoding="utf-8",
    )
    gh.chmod(0o755)


@pytest.mark.platforms("macos")
@pytest.mark.parametrize("inherit_extra", [False, True])
def test_launchd_path_runs_user_cli_and_homebrew_cli_from_minimal_environment(service, tmp_path, monkeypatch, inherit_extra):
    import pwd
    from hermes_cli import gateway

    inherited = tmp_path / "inherited-bin"
    if inherit_extra:
        monkeypatch.setenv("PATH", f"{MINIMAL_PATH}:{inherited}")
    local_bin = tmp_path / ".local" / "bin"
    local_bin.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USER", "spoofed-launcher")
    claude = local_bin / "claude"
    claude.write_text("#!/bin/sh\nprintf 'direct-sdk-ready\\n'\n", encoding="utf-8")
    claude.chmod(0o755)
    brew = tmp_path / "brew" / "bin"
    brew.mkdir(parents=True)
    gh = brew / "gh"
    gh.write_text("#!/bin/sh\nprintf 'github-ready\\n'\n", encoding="utf-8")
    gh.chmod(0o755)
    monkeypatch.setattr(known_dirs, "homebrew_dirs", lambda: (str(brew),))
    monkeypatch.setattr(gateway, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(gateway, "get_python_path", lambda: sys.executable)

    paths = []
    for profile in ("a", "b", "a"):
        home = tmp_path / ".hermes" / "profiles" / profile
        (home / "node" / "bin").mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv("HERMES_HOME", str(home))
        plist = plistlib.loads(gateway.generate_launchd_plist().encode())
        env = plist["EnvironmentVariables"]
        path = env["PATH"].split(os.pathsep)
        paths.append(path)
        assert env["HERMES_HOME"] == str(home)
        assert env["HOME"] == str(tmp_path)
        assert env["USER"] == pwd.getpwuid(os.getuid()).pw_name
        assert path.index(str(home / "node" / "bin")) < path.index(str(local_bin))
        assert path.index(str(local_bin)) < path.index(str(brew))
        if inherit_extra:
            assert path[-1] == str(inherited)
        else:
            assert set(MINIMAL_PATH.split(os.pathsep)).issubset(path)
        assert len(path) == len(set(path))
        for command, expected in (("claude", "direct-sdk-ready"), ("gh", "github-ready")):
            result = subprocess.run([command], env=env, text=True, capture_output=True, check=True)
            assert result.stdout.strip() == expected
    assert paths[0] == paths[2]
    assert str(tmp_path / ".hermes" / "profiles" / "a" / "node" / "bin") not in paths[1]


@pytest.mark.platforms("macos")
@pytest.mark.parametrize("brew_index", [0, 1])
def test_launchd_path_and_github_fallback_keep_published_cards_readable(service, tmp_path, monkeypatch, brew_index):
    from hermes_cli import gateway

    monkeypatch.setattr(gateway, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(gateway, "get_python_path", lambda: sys.executable)
    plist = plistlib.loads(gateway.generate_launchd_plist().encode())
    service_path = plist["EnvironmentVariables"]["PATH"].split(":")
    assert set(known_dirs.homebrew_dirs()).issubset(service_path)
    assert set(MINIMAL_PATH.split(":")).issubset(service_path)
    assert len(service_path) == len(set(service_path))
    assert plist["EnvironmentVariables"]["HERMES_HOME"] == str(tmp_path / ".hermes")

    # Existing plists and GUI backends still have a minimal PATH until restart.
    brew_dirs = (tmp_path / "brew-arm" / "bin", tmp_path / "brew-intel" / "bin")
    state_file = tmp_path / "pr.json"
    state_file.write_text(json.dumps({"state": "open", "merged": False}))
    install_gh(brew_dirs[brew_index], state_file)
    monkeypatch.setattr(known_dirs, "homebrew_dirs", lambda: tuple(map(str, brew_dirs)))
    monkeypatch.setattr(known_dirs, "user_local_bin", lambda: ())
    assert github_api.github_token() == "test-only-token"
    conn, tid = service
    for _ in range(3):
        result = dispatch.dispatch_once(conn, dry_run=False, spawn_fn=lambda *_: pytest.fail("duplicate spawn"))
        assert dict(result.respawn_guarded) == {tid: "active_pr"}
    assert kb.list_comments(conn, tid) == []
    assert len([e for e in kb.list_events(conn, tid) if e.kind == "guarded"]) == 1

    state_file.write_text(json.dumps({"state": "closed", "merged": True}))
    spawned = []
    result = dispatch.dispatch_once(conn, spawn_fn=lambda task, _: spawned.append(task.id))
    assert not result.respawn_guarded
    assert spawned == [tid]


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("fault, expected", [
    (None, "gh executable not found"),
    ({"exit": 4, "stderr": "credential-must-not-leak"}, "gh has no login"),
    ({"exit": 1, "stderr": "HTTP 403 credential-must-not-leak"}, "HTTP 403"),
    ({"exit": 1, "stderr": "credential-must-not-leak"}, "gh api exited with status 1"),
    ("not-json credential-must-not-leak", "invalid PR state"),
])
def test_unreadable_published_pr_gets_one_safe_comment(service, tmp_path, monkeypatch, fault, expected):
    brew = tmp_path / "brew" / "bin"
    state_file = tmp_path / "pr.json"
    if fault is not None:
        state_file.write_text(json.dumps(fault))
        install_gh(brew, state_file)
    monkeypatch.setattr(known_dirs, "homebrew_dirs", lambda: (str(brew),))
    monkeypatch.setattr(known_dirs, "user_local_bin", lambda: ())
    conn, tid = service
    spawn = lambda *_: pytest.fail("unknown PR state must not spawn a duplicate")
    assert dict(dispatch.dispatch_once(conn, dry_run=True, spawn_fn=spawn).respawn_guarded) == {
        tid: "pr_state_unavailable"}
    assert kb.list_comments(conn, tid) == []
    for _ in range(3):
        assert dict(dispatch.dispatch_once(conn, spawn_fn=spawn).respawn_guarded) == {
            tid: "pr_state_unavailable"}
    comments = kb.list_comments(conn, tid)
    assert len(comments) == 1
    assert PR in comments[0].body and expected in comments[0].body
    assert "credential-must-not-leak" not in comments[0].body
    assert kb.get_task(conn, tid).status == "ready"
    events = [e for e in kb.list_events(conn, tid) if e.kind == "commented"]
    assert len(events) == 1 and events[0].run_id is None
    assert "credential-must-not-leak" not in json.dumps([e.payload for e in kb.list_events(conn, tid)])
