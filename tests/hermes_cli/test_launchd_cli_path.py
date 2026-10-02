"""Launchd retains user-local and Homebrew CLIs without shell inheritance."""
import os
import plistlib
import subprocess
import sys
from pathlib import Path

import pytest
from hermes_platform.resolver import known_dirs

MINIMAL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"


@pytest.mark.platforms("macos")
@pytest.mark.parametrize("inherit_extra", [False, True])
def test_launchd_path_runs_user_cli_and_homebrew_cli_from_minimal_environment(tmp_path, monkeypatch, inherit_extra):
    import pwd
    from hermes_cli import gateway

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("PATH", MINIMAL_PATH)
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
