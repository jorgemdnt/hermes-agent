from types import SimpleNamespace

from agent.subscription_activity import latest, mark


def test_claude_dispatch_passes_private_context_to_native_client(_isolate_hermes_home, monkeypatch):
    from agent.turn_api_call import perform_api_call
    captured = {}
    agent = SimpleNamespace(provider="claude-subscription-directsdk-experimental", api_mode="chat_completions",
                            base_url="process://claude", session_id="chat-1", model="opus", platform="cli",
                            _disable_streaming=True, _model_request_active=None, _pending_redirect_lock=None,
                            _has_pending_redirect=lambda: False, _credential_pool=None, is_subagent=False,
                            _interruptible_api_call=lambda kwargs: captured.update(kwargs) or "response")
    monkeypatch.setattr("hermes_cli.middleware.run_llm_execution_middleware", lambda request, callback, **_: callback(request))
    monkeypatch.setattr("agent.relay_llm.execute", lambda request, callback, **_: callback(request))
    verdict = perform_api_call(agent, api_kwargs={"model": "opus"}, _original_api_kwargs={},
                               _llm_middleware_trace=[], _moa_prepared_request=None, _retry=None,
                               thinking_spinner=None, retry_count=0, api_call_count=1, api_request_id="req-1",
                               effective_task_id=None, turn_id="turn-1", interrupted=False)
    assert verdict.action == "fallthrough" and verdict.response == "response"
    assert captured["_hermes_subscription_activity"] == ("chat-1", "req-1")
    assert latest("anthropic", "chat-1") is None  # Only the plugin knows which account native selected.



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
