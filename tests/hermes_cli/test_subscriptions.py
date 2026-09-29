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
    for access, refresh in (("first-access", "first-refresh"), ("second-access", "second-refresh")):
        _append_device_oauth("openai-codex", access_token=access, refresh_token=refresh,
                             base_url="https://chatgpt.com/backend-api", last_refresh="2026-09-28T00:00:00Z")
    assert [(row.access_token, row.refresh_token) for row in load_pool("openai-codex").entries()] == [
        ("first-access", "first-refresh"), ("second-access", "second-refresh")]
    asyncio.run(remove_credential_pool_entry("openai-codex", 2))
    assert [(row.access_token, row.refresh_token) for row in load_pool("openai-codex").entries()] == [
        ("first-access", "first-refresh")]


def test_subscription_route_uses_sanitized_snapshot_and_cache_bypass(_isolate_hermes_home, monkeypatch):
    from starlette.testclient import TestClient
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    calls = []
    def snapshot(*, fresh=False):
        calls.append(fresh)
        return {"providers": [{"provider": "openai-codex", "entries": [{"account": "account@example.com", "windows": {}}]}]}
    monkeypatch.setattr("hermes_cli.subscriptions.subscription_snapshot", snapshot)
    client = TestClient(app)
    headers = {_SESSION_HEADER_NAME: _SESSION_TOKEN}
    assert client.get("/api/subscriptions?fresh=true", headers=headers).json() == snapshot(fresh=True)
    assert calls == [True, True]


def test_claude_status_follows_plugin_config_without_misattributing_other_login(monkeypatch):
    import json
    from hermes_cli.subscriptions import _claude_status
    monkeypatch.setenv("CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR", "/isolated/claude")
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    monkeypatch.setattr("agent.anthropic_credentials.read_claude_code_credentials", lambda: (_ for _ in ()).throw(AssertionError("ordinary login read")))
    def fake_run(argv, **kwargs):
        assert argv == ["claude", "auth", "status"]
        assert kwargs["env"]["CLAUDE_CONFIG_DIR"] == "/isolated/claude"
        assert "CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR" not in kwargs["env"]
        from types import SimpleNamespace
        return SimpleNamespace(stdout=json.dumps({"loggedIn": True, "email": "separate@example.com", "subscriptionType": "max"}))
    monkeypatch.setattr("subprocess.run", fake_run)
    assert _claude_status() == [{"id": "claude-cli", "index": None, "account": "separate@example.com", "plan": "Claude Max",
                                  "status": "active", "windows": {}, "in_use": True}]


def test_failed_usage_probe_exposes_no_provider_exception(monkeypatch):
    from types import SimpleNamespace
    from hermes_cli.subscriptions import _cached_limits
    monkeypatch.setattr("hermes_cli.subscriptions._limits", lambda *_: (_ for _ in ()).throw(RuntimeError("secret-provider-response")))
    assert _cached_limits("xai-oauth", SimpleNamespace(id="failed-probe"), fresh=True) == {"plan": None, "windows": {}}
