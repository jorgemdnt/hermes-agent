from unittest.mock import patch

from hermes_cli.subscriptions import codex_windows, grok_windows, claude_windows, _cached_limits


def test_weekly_only_is_not_five_hour():
    weekly = {"rate_limit": {"primary_window": {"limit_window_seconds": 604800,
               "used_percent": 24, "reset_at": 1791064000}}}
    assert set(codex_windows(weekly)) == {"weekly"}
    assert codex_windows({"rate_limit": {"primary_window": {"used_percent": 24}}}) == {}
    assert set(codex_windows({"rate_limit": {"primary_window": {"limit_window_seconds": 18000,
        "used_percent": 12}, "secondary_window": weekly["rate_limit"]["primary_window"]}})) == {"five_hour", "weekly"}


def test_grok_labels_weekly_only_for_seven_day_period_with_actual_percent():
    config = {"currentPeriod": {"start": "2026-09-26T00:00:00Z", "end": "2026-10-03T00:00:00Z"},
              "creditUsagePercent": 19}
    assert grok_windows({"config": config})["weekly"]["used_percent"] == 19
    assert grok_windows({"config": {**config, "creditUsagePercent": None}}) == {}
    assert grok_windows({"config": {**config, "currentPeriod": {**config["currentPeriod"], "end": "2026-10-26T00:00:00Z"}}}) == {}


def test_claude_missing_windows_not_invented():
    assert set(claude_windows({"five_hour": {"utilization": 2, "resets_at": "2026-09-29T00:00:00Z"}})) == {"five_hour"}


def test_subscription_cache_per_entry_and_refresh():
    from types import SimpleNamespace
    first, second = SimpleNamespace(id="a"), SimpleNamespace(id="b")
    with patch("hermes_cli.subscriptions._limits", side_effect=lambda provider, entry: {"plan": entry.id, "windows": {}}) as fetch:
        assert _cached_limits("openai-codex", first, fresh=True)["plan"] == "a"
        assert _cached_limits("openai-codex", first, fresh=False)["plan"] == "a"
        assert _cached_limits("openai-codex", second, fresh=False)["plan"] == "b"
        assert fetch.call_count == 2
        _cached_limits("openai-codex", first, fresh=True)
        assert fetch.call_count == 3


def test_append_and_remove_one_keep_other_account(_isolate_hermes_home, monkeypatch):
    import asyncio
    from hermes_cli import auth as auth_mod
    from hermes_cli.web_server_oauth import _append_device_oauth
    from hermes_cli.web_routers.ops import remove_credential_pool_entry
    from agent.credential_pool import load_pool
    monkeypatch.setattr(auth_mod, "_save_codex_tokens", lambda *_: (_ for _ in ()).throw(AssertionError("singleton overwritten")))
    monkeypatch.setattr(auth_mod, "_save_xai_oauth_tokens", lambda *_: (_ for _ in ()).throw(AssertionError("singleton overwritten")))
    for provider, base_url in (("openai-codex", "https://chatgpt.com/backend-api"),
                               ("xai-oauth", "https://api.x.ai/v1")):
        for access, refresh in (("first-access", "first-refresh"), ("second-access", "second-refresh")):
            _append_device_oauth(provider, access_token=access, refresh_token=refresh,
                                 base_url=base_url, last_refresh="2026-09-28T00:00:00Z")
        assert [(row.access_token, row.refresh_token) for row in load_pool(provider).entries()] == [
            ("first-access", "first-refresh"), ("second-access", "second-refresh")]
        asyncio.run(remove_credential_pool_entry(provider, 2))
        assert [(row.access_token, row.refresh_token) for row in load_pool(provider).entries()] == [
            ("first-access", "first-refresh")]


def test_subscription_route_uses_sanitized_snapshot_and_cache_bypass(_isolate_hermes_home, monkeypatch):
    from starlette.testclient import TestClient
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    calls = []
    def snapshot(*, fresh=False, session_id=None):
        calls.append((fresh, session_id))
        return {"providers": [{"provider": "openai-codex", "entries": [{"account": "account@example.com", "windows": {}}]}]}
    monkeypatch.setattr("hermes_cli.subscriptions.subscription_snapshot", snapshot)
    client = TestClient(app)
    headers = {_SESSION_HEADER_NAME: _SESSION_TOKEN}
    assert client.get("/api/subscriptions?fresh=true&session_id=chat-1", headers=headers).json() == snapshot(fresh=True, session_id="chat-1")
    assert calls == [(True, "chat-1"), (True, "chat-1")]


def test_claude_status_follows_plugin_config_without_misattributing_other_login(monkeypatch):
    from types import SimpleNamespace
    from hermes_cli.subscriptions import _claude_status
    monkeypatch.setattr("providers.get_provider_profile", lambda _: SimpleNamespace(subscription_accounts=lambda: [
        {"id": "isolated", "dir": "/isolated/claude", "auth": {"email": "separate@example.com", "subscriptionType": "max"}}]))
    monkeypatch.setattr("agent.anthropic_credentials.read_claude_code_credentials", lambda: (_ for _ in ()).throw(AssertionError("ordinary login read")))
    assert _claude_status() == [{"id": "isolated", "index": 1, "account": "separate@example.com", "plan": "Claude Max",
                                  "status": "active", "windows": {}, "in_use": False}]


def test_existing_claude_cli_login_shows_as_first_active_subscription(monkeypatch):
    from types import SimpleNamespace
    from hermes_cli.subscriptions import _claude_status
    monkeypatch.setattr("providers.get_provider_profile", lambda _: SimpleNamespace(subscription_accounts=lambda: [
        {"id": "claude-cli", "dir": None, "auth": {"email": "existing@example.com", "subscriptionType": "max", "authMethod": "claude.ai"}}]))
    monkeypatch.setattr("agent.anthropic_credentials.read_claude_code_credentials", lambda: {"accessToken": "fixture"})
    monkeypatch.setattr("hermes_cli.subscriptions._cached_limits", lambda *args, **kwargs: {"windows": {"five_hour": {"used_percent": 12, "reset_at": None}}})
    rows = _claude_status()
    assert [(row["id"], row["account"], row["plan"], row["status"]) for row in rows] == [
        ("claude-cli", "existing@example.com", "Claude Max", "active")]
    assert rows[0]["windows"]["five_hour"]["used_percent"] == 12


def test_failed_usage_probe_exposes_no_provider_exception(monkeypatch):
    from types import SimpleNamespace
    from hermes_cli.subscriptions import _cached_limits
    monkeypatch.setattr("hermes_cli.subscriptions._limits", lambda *_: (_ for _ in ()).throw(RuntimeError("secret-provider-response")))
    assert _cached_limits("xai-oauth", SimpleNamespace(id="failed-probe"), fresh=True) == {"plan": None, "windows": {}}
