"""Remote CDP is fenced only for the opted-in profile and its forwarded endpoint."""
from pathlib import Path

from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from tools.bot_desktop import lease, remote
from tools.browser_tool_session import run_fenced


def test_live_forward_avoids_second_remote_status_probe(monkeypatch, tmp_path: Path):
    home = tmp_path / "samwise"
    home.mkdir()
    token = set_hermes_home_override(home)
    try:
        remote._last_live_status.clear()
        calls = []
        def probe(cfg, code):
            calls.append(code)
            return {"status": {"running": True, "supported": True, "installed": True}, "port": 19222}
        monkeypatch.setattr(remote, "_run", probe)
        monkeypatch.setattr(remote, "ensure_forward", lambda cfg, remote_port: True)
        monkeypatch.setattr(remote, "_forward_alive", lambda pid, cfg, port: True)
        remote._state().mkdir()
        (remote._state() / "forward.pid").write_text("123")
        (remote._state() / "rfb.sock").touch()
        first = remote.status({})
        assert remote.status({}) == first
        assert len(calls) == 1
        monkeypatch.setattr(remote, "_forward_alive", lambda pid, cfg, port: False)
        remote.status({})
        assert len(calls) == 2
    finally:
        remote._last_live_status.clear()
        reset_hermes_home_override(token)


def test_observe_status_uses_existing_rfb_forward_without_remote_probe(monkeypatch, tmp_path: Path):
    import socket
    import threading
    import psutil
    import os
    import tempfile
    import shutil

    home = tmp_path / "samwise"
    home.mkdir()
    token = set_hermes_home_override(home)
    short = Path(tempfile.mkdtemp(prefix="rfb-", dir=os.environ["TMPDIR"]))
    monkeypatch.setattr(remote, "_state", lambda: short)
    try:
        state = remote._state()
        sock_path = state / "rfb.sock"
        (state / "forward.pid").write_text("123")
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(sock_path))
        listener.listen(1)
        monkeypatch.setattr(psutil, "Process", lambda pid: type("Forward", (), {"cmdline": lambda self: ["127.0.0.1:19222:127.0.0.1:5901"]})())
        monkeypatch.setattr(remote, "_forward_alive", lambda pid, cfg, port: port == 5901)
        monkeypatch.setattr(remote, "status", lambda cfg: (_ for _ in ()).throw(AssertionError("slow SSH probe")))
        def serve_banner():
            connection, _ = listener.accept()
            with connection:
                connection.sendall(b"RFB 003.008\n")
        worker = threading.Thread(target=serve_banner)
        worker.start()
        try:
            observed = remote.observe_status({"cdp_local_port": 19222})
            assert observed["running"] is True
            assert observed["transport"] == "rfb"
            assert observed["socket"] == str(sock_path)
        finally:
            worker.join(timeout=2)
            listener.close()
    finally:
        shutil.rmtree(short)
        reset_hermes_home_override(token)


def test_remote_cdp_fence_is_profile_scoped(tmp_path: Path):
    homes = [tmp_path / "a", tmp_path / "b"]
    for home in homes:
        home.mkdir()
    (homes[0] / "config.yaml").write_text(
        "bot_desktop:\n  remote_ssh:\n    host: 100.92.180.34\n    user: hermes\n"
        "    source_dir: /home/hermes/hermes-agent\n    cdp_local_port: 19222\n",
        encoding="utf-8",
    )
    session = {"features": {"cdp_override": True},
               "cdp_url": "ws://127.0.0.1:19222/devtools/browser/abc"}
    unrelated = {**session, "cdp_url": "ws://127.0.0.1:19223/devtools/browser/abc"}
    try:
        for home, shared in [(homes[0], True), (homes[1], False), (homes[0], True)]:
            token = set_hermes_home_override(home)
            try:
                assert remote.is_shared_cdp(session) is shared
                assert remote.is_shared_cdp(unrelated) is False
                lease.acquire("human-viewer")
                result = run_fenced(session, lambda: {"success": True})
                if shared:
                    assert result["code"] == "human_has_control"
                else:
                    assert result == {"success": True}
            finally:
                reset_hermes_home_override(token)
    finally:
        for home in homes:
            token = set_hermes_home_override(home)
            try:
                lease.release("human-viewer")
            finally:
                reset_hermes_home_override(token)
