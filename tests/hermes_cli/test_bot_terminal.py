import pytest
import socket
from pathlib import Path
from types import SimpleNamespace
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server
from hermes_cli.web_bot_terminal import client_on_server_host, remote_folder_exists, resolve_terminal_folder, shell_argv, stored_session_folder
from hermes_cli.web_routers import chat_ws
import hermes_cli.web_server_chat as chat_bridge


def test_local_shell_uses_configured_cwd(tmp_path):
    argv, cwd = shell_argv({"backend": "local", "cwd": str(tmp_path)})
    assert cwd == str(tmp_path)
    assert argv[-1] == "-l"
    assert client_on_server_host("127.0.0.1")
    assert not client_on_server_host("198.51.100.10")


def test_tailnet_interface_counts_as_this_server(monkeypatch):
    import psutil
    monkeypatch.setattr(psutil, "net_if_addrs", lambda: {"utun9": [SimpleNamespace(family=socket.AF_INET, address="100.121.114.44")]})
    assert client_on_server_host("100.121.114.44")
    assert not client_on_server_host("100.121.114.45")


def test_ssh_shell_uses_backend_identity_not_a_host_path():
    argv, cwd = shell_argv({"backend": "ssh", "cwd": "/home/hermes/work/artemis",
                            "ssh_host": "samwise.test", "ssh_user": "hermes"})
    assert cwd is None
    assert "hermes@samwise.test" in argv
    assert argv[-1] == "cd -- /home/hermes/work/artemis && exec ${SHELL:-/bin/bash} -l"
    assert "-tt" in argv


def test_terminal_folder_follows_session_then_project_then_config_then_home(tmp_path):
    project = tmp_path / "project"
    configured = tmp_path / "configured"
    project.mkdir()
    configured.mkdir()
    config = {"backend": "local", "cwd": str(configured)}
    assert resolve_terminal_folder(config, {"cwd": str(project), "git_repo_root": str(configured)}) == str(project)
    assert resolve_terminal_folder(config, {"cwd": "", "git_repo_root": str(project)}) == str(project)
    assert resolve_terminal_folder(config, {"cwd": str(tmp_path / "deleted"), "git_repo_root": ""}) == str(configured)
    assert resolve_terminal_folder({"backend": "local", "cwd": "."}, None) == str(Path.home())


def test_remote_folder_is_never_resolved_on_dashboard_host(monkeypatch):
    import hermes_cli.web_bot_terminal as bot_terminal
    monkeypatch.setattr(bot_terminal, "remote_folder_exists", lambda _config, folder: folder != "/Users/jorgemodesto")
    folder = "/home/hermes/work/it's-a-project"
    config = {"backend": "ssh", "cwd": "/home/hermes", "ssh_host": "samwise.test", "ssh_user": "hermes"}
    assert resolve_terminal_folder(config, {"cwd": folder}) == folder
    argv, local_cwd = shell_argv({**config, "cwd": folder})
    assert local_cwd is None
    assert argv[-1] == "cd -- '/home/hermes/work/it'\"'\"'s-a-project' && exec ${SHELL:-/bin/bash} -l"
    assert resolve_terminal_folder({**config, "cwd": "."}, None) == "~"
    assert shell_argv({**config, "cwd": "~"})[0][-1] == 'cd -- "$HOME" && exec ${SHELL:-/bin/bash} -l'
    assert resolve_terminal_folder(config, {"cwd": "/Users/jorgemodesto"}) == "/home/hermes"


def test_remote_probe_uses_quoted_path_on_ssh_host(monkeypatch):
    import hermes_cli.web_bot_terminal as bot_terminal
    import tools.environments.ssh as ssh
    seen = []
    monkeypatch.setattr(ssh, "interactive_ssh_argv", lambda *_args, **_kw: ["ssh", "-tt", "hermes@samwise.test"])
    monkeypatch.setattr(bot_terminal.subprocess, "run", lambda argv, **_kw: (seen.append(argv) or SimpleNamespace(returncode=0)))
    assert remote_folder_exists({"ssh_host": "samwise.test", "ssh_user": "hermes"}, "/home/hermes/it's mine")
    assert seen == [["ssh", "-T", "hermes@samwise.test", "test -d '/home/hermes/it'\"'\"'s mine'"]]


def test_stored_session_is_profile_scoped_and_missing_or_mismatched_is_refused(monkeypatch):
    import hermes_cli.web_server_sessions as sessions
    seen = []
    class DB:
        def get_session(self, sid):
            return {"id": sid, "cwd": "/remote/project", "profile_name": "samwise"} if sid == "chat-1" else None
        def close(self):
            seen.append("closed")
    monkeypatch.setattr(sessions, "_open_session_db_for_profile", lambda profile, *, read_only: (seen.append((profile, read_only)) or DB()))
    monkeypatch.setattr(sessions, "_session_latest_descendant", lambda sid, db: (sid, [sid]) if db.get_session(sid) else (None, []))
    stored = stored_session_folder("samwise", "chat-1")
    assert stored is not None and stored["cwd"] == "/remote/project"
    assert seen == [("samwise", True), "closed"]
    with pytest.raises(ValueError):
        stored_session_folder("default", "chat-1")
    with pytest.raises(ValueError):
        stored_session_folder("samwise", "../../other")
    with pytest.raises(ValueError):
        stored_session_folder("samwise", "not-found")
    assert stored_session_folder("samwise", "new") is None


def test_bot_terminal_rejects_anonymous_and_loopback_token(monkeypatch):
    spawned = []
    monkeypatch.setattr(chat_bridge.PtyBridge, "spawn", lambda *a, **kw: spawned.append(a))
    client = TestClient(web_server.app)
    with pytest.raises(WebSocketDisconnect) as anonymous:
        with client.websocket_connect("/api/bot-terminal?profile=default") as ws:
            ws.receive_text()
    assert anonymous.value.code == 4401
    from hermes_cli.web_server import _SESSION_TOKEN
    with pytest.raises(WebSocketDisconnect) as token:
        with client.websocket_connect(f"/api/bot-terminal?profile=default&token={_SESSION_TOKEN}") as ws:
            ws.receive_text()
    assert token.value.code == 4403
    assert not spawned


def test_bot_terminal_accepts_signed_in_identity_and_streams(monkeypatch, tmp_path):
    class FakeBridge:
        def read(self, _timeout):
            return b""
        async def write(self, data):
            written.append(data)
            return True
        def resize(self, cols, rows):
            dimensions.append((cols, rows))
        def close(self):
            pass
    written, dimensions, launched = [], [], []
    async def authenticated(ws, _kind):
        ws._hermes_auth_identity = {"user_id": "owner", "provider": "google"}
        return ("testclient", "gated", "ticket")
    monkeypatch.setattr(chat_ws, "_ws_gate", authenticated)
    monkeypatch.setattr(chat_ws, "_ws_auth_mode", lambda: "gated")
    monkeypatch.setattr(chat_ws, "_resolve_profile_dir", lambda _name: tmp_path, raising=False)
    monkeypatch.setattr(chat_ws, "terminal_config", lambda _name: {"backend": "local", "cwd": str(tmp_path)}, raising=False)
    import hermes_cli.web_bot_terminal as bot_terminal
    monkeypatch.setattr(bot_terminal, "terminal_config", lambda _name: {"backend": "local", "cwd": str(tmp_path)})
    def spawn(argv, **kwargs):
        launched.append((argv, kwargs["cwd"]))
        return FakeBridge()
    monkeypatch.setattr(chat_bridge.PtyBridge, "spawn", spawn)
    client = TestClient(web_server.app)
    with client.websocket_connect("/api/bot-terminal?profile=default") as ws:
        ws.send_text("pwd\n")
        ws.send_text("\x1b[RESIZE:100;32]")
    assert launched and launched[0][1] == str(tmp_path)
    assert written == [b"pwd\n"]
    assert dimensions == [(100, 32)]


def test_terminal_endpoint_uses_stored_remote_folder_not_client_cwd(monkeypatch, tmp_path):
    import hermes_cli.web_bot_terminal as bot_terminal
    import hermes_cli.web_server_profiles as profiles

    remote = "/home/hermes/work/project with spaces"
    config = {"backend": "ssh", "cwd": "/home/hermes", "ssh_host": "samwise.test", "ssh_user": "hermes"}
    monkeypatch.setattr(profiles, "_resolve_profile_dir", lambda _profile: tmp_path)
    monkeypatch.setattr(bot_terminal, "terminal_config", lambda _profile: config)
    monkeypatch.setattr(bot_terminal, "stored_session_folder", lambda profile, sid: {"cwd": remote, "profile_name": profile} if sid == "chat-1" else None)
    monkeypatch.setattr(bot_terminal, "remote_folder_exists", lambda _config, _folder: True)
    from hermes_cli.web_server import _SESSION_TOKEN
    client = TestClient(web_server.app, headers={"X-Hermes-Session-Token": _SESSION_TOKEN})
    response = client.get("/api/bot-terminal/folder?profile=samwise&session=chat-1")
    assert response.status_code == 200
    assert response.json() == {"folder": remote}
    assert client.get("/api/bot-terminal/folder?profile=samwise&session=chat-1&cwd=/tmp/attacker").status_code == 400

    launched = []
    class FakeBridge:
        def read(self, _timeout):
            return b""
        def close(self):
            pass
    async def authenticated(ws, _kind):
        ws._hermes_auth_identity = {"user_id": "owner", "provider": "google"}
        return ("testclient", "gated", "ticket")
    monkeypatch.setattr(chat_ws, "_ws_gate", authenticated)
    monkeypatch.setattr(chat_ws, "_ws_auth_mode", lambda: "gated")
    monkeypatch.setattr(chat_bridge.PtyBridge, "spawn", lambda argv, **kw: (launched.append((argv, kw["cwd"])) or FakeBridge()))
    with client.websocket_connect("/api/bot-terminal?profile=samwise&session=chat-1"):
        pass
    assert launched[0][1] is None
    assert launched[0][0][-1] == "cd -- '/home/hermes/work/project with spaces' && exec ${SHELL:-/bin/bash} -l"
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect("/api/bot-terminal?profile=samwise&session=chat-1&cwd=/tmp/attacker") as ws:
            ws.receive_text()
    assert refused.value.code == 4403
    assert len(launched) == 1


def test_bot_terminal_rejects_internal_credential_even_when_gate_passes(monkeypatch):
    async def internal(ws, _kind):
        ws._hermes_auth_identity = {"user_id": "internal", "provider": "internal"}
        return ("testclient", "gated", "internal")
    monkeypatch.setattr(chat_ws, "_ws_gate", internal)
    monkeypatch.setattr(chat_ws, "_ws_auth_mode", lambda: "gated")
    with pytest.raises(WebSocketDisconnect) as denied:
        with TestClient(web_server.app).websocket_connect("/api/bot-terminal?profile=default") as ws:
            ws.receive_text()
    assert denied.value.code == 4403
