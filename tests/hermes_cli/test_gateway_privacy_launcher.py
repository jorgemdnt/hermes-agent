"""Real macOS helper contracts: scoped opt-in, stable identity and launchd lifecycle."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import sys
import time

import pytest

from hermes_cli import gateway
from hermes_cli import gateway_privacy_launcher as privacy
from hermes_cli.gateway_launchd import launchd_program_arguments
from scripts.build.gateway_launcher import build_launcher

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def helper_app(tmp_path):
    app = tmp_path / 'Hermes with "quotes".app'
    resources = app / "Contents/Resources"
    resources.mkdir(parents=True)
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIconFile": "icon.icns", "CFBundleVersion": "1",
    }))
    shutil.copy2(ROOT / "apps/desktop/assets/icon.icns", resources / "icon.icns")
    return app, build_launcher(app)


@pytest.mark.platforms("macos")
def test_registered_responsibility_is_profile_local_and_fail_closed(helper_app, tmp_path, monkeypatch):
    desktop, helper = helper_app
    home_a, home_b = tmp_path / "a", tmp_path / "b"
    home_a.mkdir()
    home_b.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    # Unit integration must not persist its disposable bundle in Launch Services.
    real_run = subprocess.run

    def run(command, **kwargs):
        if command[0].endswith("/lsregister"):
            return subprocess.CompletedProcess(command, 0)
        return real_run(command, **kwargs)

    monkeypatch.setattr(privacy.subprocess, "run", run)
    monkeypatch.setenv("HERMES_HOME", str(home_a))
    before = plistlib.loads(gateway.generate_launchd_plist().encode())
    record = privacy.register(desktop)
    after = plistlib.loads(gateway.generate_launchd_plist().encode())
    assert after["ProgramArguments"] == [str(helper / "Contents/MacOS/HermesGateway"), "--gateway", *before["ProgramArguments"]]
    assert after["AssociatedBundleIdentifiers"] == [privacy.BUNDLE_ID]
    for key in ("WorkingDirectory", "EnvironmentVariables", "KeepAlive", "ExitTimeOut", "StandardOutPath", "StandardErrorPath"):
        assert after[key] == before[key]
    assert "cdhash" not in json.loads(record.read_text())["requirement"]
    monkeypatch.setenv("HERMES_HOME", str(home_b))
    shutil.copy2(record, home_b / record.name)
    other = plistlib.loads(gateway.generate_launchd_plist().encode())
    assert other["ProgramArguments"][0] == "/usr/bin/osascript"
    assert "AssociatedBundleIdentifiers" not in other
    monkeypatch.setenv("HERMES_HOME", str(home_a))
    assert plistlib.loads(gateway.generate_launchd_plist().encode()) == after
    record.chmod(0o644)
    with pytest.raises(RuntimeError, match="owner-only"):
        gateway.generate_launchd_plist()
    record.chmod(0o600)
    (helper / "Contents/Resources/Hermes.icns").write_bytes(b"invalidated signature")
    with pytest.raises(subprocess.CalledProcessError):
        gateway.generate_launchd_plist()


@pytest.mark.platforms("macos")
def test_native_wrapper_preserves_exit_status_process_group_and_stop(helper_app, tmp_path):
    _, helper = helper_app
    executable = helper / "Contents/MacOS/HermesGateway"
    stdout, stderr = tmp_path / "stdout", tmp_path / "stderr"
    child = [sys.executable, "-c", "import os,sys; print(os.getpgrp()); sys.exit(75)"]
    wrapper = subprocess.Popen([str(executable), "--", *launchd_program_arguments(child, stdout, stderr)], start_new_session=True)
    try:
        assert wrapper.wait(timeout=15) == 75
        assert int(stdout.read_text()) == wrapper.pid
        assert stderr.read_text() == ""
    finally:
        if wrapper.poll() is None:
            os.killpg(wrapper.pid, signal.SIGKILL)
            wrapper.wait()
    # A launchd updater signals the native root, not osascript. Both user
    # signals must cross the real timestamp-wrapper chain without killing it.
    for number in (signal.SIGUSR1, signal.SIGUSR2):
        ready = tmp_path / f"ready-{number}"
        script = tmp_path / f"child-{number}.py"
        script.write_text(
            "import os,pathlib,signal,sys,time\n"
            "assert 'HERMES_GATEWAY_SIGNAL_FD' not in os.environ\n"
            f"signal.signal({number}, lambda *_: sys.exit(75))\n"
            f"pathlib.Path({str(ready)!r}).touch()\n"
            "time.sleep(60)\n"
        )
        command = [sys.executable, "-m", "hermes_cli.stderr_timestamp", "--error-log", str(stderr), "--", sys.executable, str(script)]
        wrapper = subprocess.Popen([str(executable), "--gateway", *launchd_program_arguments(command, stdout, stderr)], start_new_session=True)
        try:
            deadline = time.monotonic() + 10
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.05)
            assert ready.exists()
            wrapper.send_signal(number)
            assert wrapper.wait(timeout=10) == 75
        finally:
            if wrapper.poll() is None:
                os.killpg(wrapper.pid, signal.SIGKILL)
                wrapper.wait()
    ready = tmp_path / "ready"
    child = [sys.executable, "-c", "import pathlib,sys,time; pathlib.Path(sys.argv[1]).touch(); time.sleep(60)", str(ready)]
    wrapper = subprocess.Popen([str(executable), "--", *child], start_new_session=True)
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert ready.exists()
        wrapper.send_signal(signal.SIGTERM)
        assert wrapper.wait(timeout=10) == 128 + signal.SIGTERM
    finally:
        if wrapper.poll() is None:
            os.killpg(wrapper.pid, signal.SIGKILL)
            wrapper.wait()
