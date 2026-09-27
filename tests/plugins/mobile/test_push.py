"""Behavioral coverage for authenticated mobile Web Push state and replayable prompts."""
from __future__ import annotations

import base64
import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from plugins.mobile import push
from tui_gateway import server_requests


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _subscription() -> dict:
    key = ec.generate_private_key(ec.SECP256R1())
    return {"endpoint": "https://web.push.apple.com/registration/fixture", "keys": {
        "p256dh": _b64(key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
        "auth": _b64(os.urandom(16))}}


def test_subscription_persists_privately_and_cannot_send_to_arbitrary_hosts(tmp_path: Path):
    home = tmp_path / "hermes"
    home.mkdir()
    one = _subscription()
    push.subscribe(home, one, "jorge")
    assert push.has_subscriptions(home)
    assert (home / "mobile/subscriptions.json").stat().st_mode & 0o077 == 0
    assert len(push.public_key(home)) > 50
    assert (home / "mobile/vapid.pem").stat().st_mode & 0o077 == 0
    unsafe = {**one, "endpoint": "https://127.0.0.1/local"}
    with pytest.raises(ValueError, match="approved HTTPS"):
        push.subscribe(home, unsafe, "jorge")
    push.unsubscribe(home, one["endpoint"], "someone-else")
    assert push.has_subscriptions(home)
    push.unsubscribe(home, one["endpoint"], "jorge")
    assert not push.has_subscriptions(home)


def test_push_sender_encrypts_payload_and_posts_to_push_service(tmp_path: Path, monkeypatch):
    home = tmp_path / "hermes"
    home.mkdir()
    push.subscribe(home, _subscription(), "jorge")
    monkeypatch.chdir(tmp_path)  # pywebpush curl mode writes encrypted.data in cwd.
    sent = []
    from pywebpush import webpush as real_webpush
    def fake_webpush(**kwargs):
        # Exercise real VAPID signing and RFC8291 encryption without network I/O.
        result = real_webpush(**{**kwargs, "curl": True})
        assert "curl" in result
        sent.append(kwargs["data"])
        return type("Response", (), {"status_code": 201})()
    monkeypatch.setattr("pywebpush.webpush", fake_webpush)
    assert push.send_pending(home, "gandalf", "clarify", "srq-test")
    assert len(sent) == 1
    assert "srq-test" in sent[0]
    assert "password" not in sent[0]


def test_mobile_api_registers_and_removes_only_own_subscription(tmp_path: Path, monkeypatch):
    from plugins.mobile.dashboard import plugin_api

    home = tmp_path / "hermes"
    home.mkdir()
    monkeypatch.setattr(plugin_api, "_home", home)
    app = FastAPI()
    app.state.user = "jorge"
    @app.middleware("http")
    async def session(request: Request, call_next):
        if app.state.user:
            request.state.session = SimpleNamespace(user_id=app.state.user)
        return await call_next(request)
    app.include_router(plugin_api.router, prefix="/api/plugins/mobile")
    client = TestClient(app)
    path = "/api/plugins/mobile/push/subscriptions"
    assert client.get("/api/plugins/mobile/push/key").status_code == 200
    subscription = _subscription()
    assert client.post(path, json=subscription).status_code == 401
    client.cookies.set("hermes_session_browser", "browser-one")
    assert client.post(path, json=subscription).status_code == 200
    assert push.has_subscriptions(home)
    app.state.user = "another"
    assert client.request("DELETE", path, json={"endpoint": subscription["endpoint"]}).status_code == 200
    assert push.has_subscriptions(home)
    app.state.user = "jorge"
    assert client.request("DELETE", path, json={"endpoint": subscription["endpoint"]}).status_code == 200
    assert not push.has_subscriptions(home)
    app.state.user = ""
    assert client.get("/api/plugins/mobile/push/key").status_code == 401

def test_logout_removes_only_the_signed_out_browser_push_endpoints(tmp_path: Path):
    home = tmp_path / "hermes"
    home.mkdir()
    first = _subscription()
    second = _subscription()
    second["endpoint"] += "-second"
    push.subscribe(home, first, "jorge", "browser-one")
    push.subscribe(home, second, "jorge", "browser-two")
    push.unsubscribe_browser(home, "someone-else", "browser-one")
    assert len(push._read(home)) == 2
    push.unsubscribe_browser(home, "jorge", "browser-one")
    assert list(push._read(home)) == [second["endpoint"]]


def test_ntfy_fallback_when_web_push_is_unavailable(tmp_path: Path, monkeypatch):
    from plugins.platforms.ntfy import adapter

    home = tmp_path / "hermes"
    home.mkdir()
    published = []
    monkeypatch.setattr(adapter, "_env_enablement", lambda: {"topic": "fixture-topic"})
    async def fake_send(config, chat_id, message):
        published.append((config.extra["topic"], chat_id, message))
        return {"success": True}
    monkeypatch.setattr(adapter, "_standalone_send", fake_send)
    push.notify_pending(home, "gandalf", "secret", "srq-fixture")
    assert published == [("fixture-topic", "", "Frodo needs you")]


def test_unattached_question_waits_and_replays_after_a_delayed_answer(monkeypatch):
    server_requests.reset_for_tests()
    frames = []
    parked = []
    server_requests.bind_sinks(frames.append, lambda *_: None, lambda sid: True)
    server_requests.register_parked_hook(lambda sid, kind, rid: parked.append((sid, kind, rid)))
    result = []
    worker = threading.Thread(target=lambda: result.append(server_requests.send(
        "clarify", "phone-session", {"questions": [{"qid": "one", "question": "Which?"}]}, timeout=3)))
    worker.start()
    try:
        deadline = time.monotonic() + 2
        while not parked and time.monotonic() < deadline:
            time.sleep(0.01)
        assert parked and len(server_requests.open_requests("phone-session")) == 1
        request_id = parked[0][2]
        assert server_requests.resolve_response({"id": request_id, "result": {"answers": {"one": "A"}}})
        worker.join(timeout=2)
        assert result == [{"answers": {"one": "A"}}]
        assert not server_requests.open_requests("phone-session")
    finally:
        server_requests.register_parked_hook(None)
        server_requests.reset_for_tests()
        server_requests.cancel("phone-session")
        worker.join(timeout=2)
