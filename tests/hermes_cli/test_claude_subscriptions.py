from types import SimpleNamespace
from unittest.mock import patch

from agent.subscription_activity import latest, mark


def test_activity_uses_dispatched_account_not_pool_cursor(_isolate_hermes_home):
    mark("openai-codex", "account-1", "chat-1", "req-1", "in_flight")
    row = latest("openai-codex", "chat-1")
    assert row and row["account_id"] == "account-1"
    mark("openai-codex", "account-2", "chat-1", "req-2", "in_flight")
    mark("openai-codex", "account-1", "chat-1", "req-1", "finished")
    row = latest("openai-codex", "chat-1")
    assert row and row["account_id"] == "account-2"
    mark("openai-codex", "account-2", "chat-1", "req-2", "finished")
    row = latest("openai-codex", "chat-1")
    assert row and row["phase"] == "finished"
    assert latest("xai-oauth", "chat-1") is None


def test_claude_cli_login_route_commits_only_on_verified_poll(_isolate_hermes_home, monkeypatch):
    from starlette.testclient import TestClient
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from hermes_cli import web_claude_subscriptions as routes
    calls = []
    process = SimpleNamespace(pid=999, poll=lambda: 0)
    login = {"id": "a" * 32, "dir": "/fake/isolated", "process": process}
    profile = SimpleNamespace(start_subscription_login=lambda: login,
                              finish_subscription_login=lambda item: calls.append("poll") or ("pending" if len(calls) == 1 else "approved"),
                              remove_subscription_account=lambda account: account == login["id"])
    monkeypatch.setattr(routes, "get_provider_profile", lambda _: profile)
    monkeypatch.setattr(routes, "_stop", lambda item, discard: calls.append(("stop", discard)))
    client = TestClient(app)
    headers = {_SESSION_HEADER_NAME: _SESSION_TOKEN}
    started = client.post("/api/subscriptions/claude/login", headers=headers)
    assert started.status_code == 200 and started.json() == {"session_id": login["id"], "status": "pending"}
    url = "/api/subscriptions/claude/login/" + login["id"]
    assert client.get(url, headers=headers).json() == {"status": "pending"}
    assert client.get(url, headers=headers).json() == {"status": "approved"}
    assert client.get(url, headers=headers).status_code == 404
    assert client.delete("/api/subscriptions/claude/accounts/" + login["id"], headers=headers).json() == {"ok": True}
    assert calls == ["poll", "poll", ("stop", False)]
