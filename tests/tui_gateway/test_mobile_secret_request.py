"""Real mobile secret request path, bound Google socket, file sink and model redaction."""
from __future__ import annotations

import asyncio
import json
import sys
import threading
import time

import pytest
from dotenv import dotenv_values

from agent.secret_scope import load_env_file
from agent.redact import redact_registered_vault_values
from hermes_constants import get_hermes_home, reset_hermes_home_override, set_hermes_home_override
from hermes_cli.dashboard_auth.local_logout import _digest, bind, browser_epoch, revoke
from tools import secret_request_tool as secrets
from tools.secret_request_tool import remove_file_secret, secret_request, validate_destination
from tui_gateway import server, server_requests
from tui_gateway.secret_requests import authorized_answer
from tui_gateway.ws import WSTransport


def test_mobile_secret_lifecycle(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    (home / "config.yaml").write_text(
        "dashboard:\n  oauth:\n    self_hosted:\n      allowed_emails:\n        - phone@example.com\n")
    assert get_hermes_home() == home
    browser_id, access = "browser", "test-access-cookie"
    bind(access, "test-refresh-cookie", browser_id)
    identity = {"provider": "self-hosted", "user_id": "google-sub", "email": "phone@example.com",
                "browser_id": browser_id, "access_digest": _digest(access),
                "browser_epoch": browser_epoch(browser_id), "session_expires_at": time.time() + 120}
    loop = asyncio.new_event_loop()
    phone = WSTransport(object(), loop, auth_identity=identity)
    internal = WSTransport(object(), loop, auth_identity={"provider": "server-internal", "user_id": "server-internal"})
    sid, key = "mobile-sid", "mobile-key"
    frames = []
    old_sinks = (server_requests._write, server_requests._emit, server_requests._answerable)
    with server._sessions_lock:
        server._sessions[sid] = {"source": "mobile", "session_key": key, "profile_home": None,
                                 "auth_user_id": "self-hosted:google-sub", "transport": phone}
    server_requests.bind_sinks(frames.append, lambda *a: None, lambda _: True)
    try:
        result = {}
        thread = threading.Thread(target=lambda: result.setdefault("tool", secret_request(
            "CANARY_TOKEN", "test file sink", {"kind": "env_file", "path": "~/.hermes/canary.env"},
            expires_in=5, task_id=key)))
        thread.start()
        deadline = time.monotonic() + 5
        while not frames and time.monotonic() < deadline:
            time.sleep(0.01)
        assert frames
        frame = frames[0]
        assert frame["method"] == "secret.request"
        assert frame["params"]["destination"]["path"] == "~/.hermes/canary.env"
        assert server_requests.resolve_response({"id": frame["id"], "result": {"value": "bad"}}, internal) is False
        canary = "sample_canary_value_not_a_credential"
        assert server_requests.resolve_response({"id": frame["id"], "result": {
            "value": canary, "destination": {"kind": "env_file", "path": "~/.hermes/wrong.env"}}}, phone)
        assert server_requests.resolve_response({"id": frame["id"], "result": {"value": canary}}, phone) is False
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert json.loads(result["tool"]) == {"stored": True, "destination": "~/.hermes/canary.env", "var": "CANARY_TOKEN"}
        path = home / "canary.env"
        assert path.stat().st_mode & 0o777 == 0o600
        assert canary in path.read_text()
        assert not (home / "wrong.env").exists()
        assert canary not in redact_registered_vault_values(path.read_text())
        audit = (home / "logs" / "secret-audit.jsonl").read_text()
        assert json.loads(audit)["google_sub"] == identity["user_id"]
        assert all(canary not in obj for obj in (result["tool"], audit, json.dumps(frames)))
        # A logged-out socket is refused even when an unrelated new sign-in
        # on that same browser rebinds its former access cookie.
        req = server_requests.ServerRequest(sid, "secret.request", {"expires_at": time.time() + 10})
        req.owner_home = str(home)
        server_requests._open[req.id] = req
        revoke(access, "test-refresh-cookie", browser_id)
        bind(access, "other-refresh", browser_id)
        assert server_requests.resolve_response({"id": req.id, "result": {"value": canary}}, phone) is False
        assert req.id in server_requests._open
        assert remove_file_secret("CANARY_TOKEN", {"kind": "env_file", "path": "~/.hermes/canary.env"})
        assert canary not in path.read_text()
        assert not remove_file_secret("CANARY_TOKEN", {"kind": "env_file", "path": "~/.hermes/canary.env"})
    finally:
        server_requests.cancel(sid)
        server_requests.bind_sinks(*old_sinks)
        with server._sessions_lock:
            server._sessions.pop(sid, None)
        loop.close()


def test_remote_env_round_trips_apostrophe_and_named_removal(tmp_path, monkeypatch):
    # Execute the actual SSH writer locally with only its fixed home changed to a
    # disposable directory; no network, live profile or credential is involved.
    base = tmp_path / "hermes"
    base.mkdir()
    script = secrets._REMOTE_WRITER.replace('pathlib.Path("/home/hermes")', f'pathlib.Path({str(base)!r})')
    assert script != secrets._REMOTE_WRITER
    path = base / ".hermes" / "canary.env"
    destination = {"kind": "remote_file", "path": "/home/hermes/.hermes/canary.env"}
    remote_command = secrets._remote_command
    monkeypatch.setattr(secrets, "_remote_command", lambda _path, name, *, remove=False:
                        [sys.executable, "-c", script, str(path), name, *(["rm"] if remove else [])])
    monkeypatch.setattr("tools.terminal_tool._get_env_config", lambda: {
        "env_type": "ssh", "ssh_user": "hermes", "ssh_host": "fixture", "ssh_port": 22, "ssh_key": ""})

    value = "synthetic's value # with \"quotes\" and \\backslash"
    assert value not in " ".join(remote_command(destination["path"], "CANARY_TOKEN"))
    secrets._write_remote(destination["path"], "CANARY_TOKEN", value)
    assert path.stat().st_mode & 0o777 == 0o600
    assert load_env_file(path)["CANARY_TOKEN"] == value
    assert dotenv_values(path)["CANARY_TOKEN"] == value
    assert remove_file_secret("CANARY_TOKEN", destination)
    assert "CANARY_TOKEN" not in load_env_file(path)
    assert not remove_file_secret("CANARY_TOKEN", destination)


def test_dashboard_authority_across_profile_scope(tmp_path, monkeypatch):
    primary = tmp_path / ".hermes"
    secondary = tmp_path / "samwise"
    primary.mkdir()
    secondary.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(primary))
    (primary / "config.yaml").write_text(
        "dashboard:\n  oauth:\n    self_hosted:\n      allowed_emails:\n        - phone@example.com\n")
    (secondary / "config.yaml").write_text("terminal:\n  backend: ssh\n")
    browser_id, access = "browser-two", "test-access-two"
    bind(access, "test-refresh-two", browser_id)
    identity = {"provider": "self-hosted", "user_id": "google-sub", "email": "phone@example.com",
                "browser_id": browser_id, "access_digest": _digest(access),
                "browser_epoch": browser_epoch(browser_id), "session_expires_at": time.time() + 30}
    loop = asyncio.new_event_loop()
    phone = WSTransport(object(), loop, auth_identity=identity)
    sid = "samwise-mobile"
    with server._sessions_lock:
        server._sessions[sid] = {"source": "mobile", "profile_home": str(secondary),
                                 "auth_user_id": "self-hosted:google-sub", "transport": phone}
    req = server_requests.ServerRequest(sid, "secret.request", {"expires_at": time.time() + 30})
    req.owner_home = str(secondary)
    try:
        token = set_hermes_home_override(secondary)
        try:
            assert authorized_answer(req, phone)
            assert get_hermes_home() == secondary
        finally:
            reset_hermes_home_override(token)
        assert get_hermes_home() == primary
        token = set_hermes_home_override(secondary)
        try:
            assert authorized_answer(req, phone)
        finally:
            reset_hermes_home_override(token)
        revoke(access, "test-refresh-two", browser_id)
        assert not authorized_answer(req, phone)
    finally:
        with server._sessions_lock:
            server._sessions.pop(sid, None)
        loop.close()


def test_destination_rejects_escape_and_unbound_origins(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    for dest in ({"kind": "env_file", "path": "~/.hermes/../escape.env"},
                 {"kind": "env_file", "path": "/tmp/escape.env"},
                 {"kind": "vault_item", "origin": "https://example.com/path", "label": "site", "identifier": "name"},
                 {"kind": "vault_item", "origin": "https://example.com", "label": "site", "identifier": "name", "path": "elsewhere"}):
        with pytest.raises(ValueError):
            validate_destination(dest, "CANARY_TOKEN")
    with pytest.raises(ValueError):
        validate_destination({"kind": "env_file", "path": "~/.hermes/okay.env"}, "BAD-NAME")
    link = home / "link"
    link.symlink_to(tmp_path)
    with pytest.raises(ValueError):
        validate_destination({"kind": "env_file", "path": "~/.hermes/link/escape.env"}, "CANARY_TOKEN")
