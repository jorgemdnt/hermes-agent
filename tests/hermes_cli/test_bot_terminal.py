import pytest
import socket
from types import SimpleNamespace
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server
from hermes_cli.web_bot_terminal import client_on_server_host, shell_argv
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
