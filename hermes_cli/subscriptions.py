"""Read-only, per-credential subscription limits for the mobile dashboard.

No token, response body or provider exception is returned or logged. A failed
provider request leaves that account's meters empty without hiding other rows.
"""
from __future__ import annotations

import math
import os
import time
from datetime import datetime, timezone
from threading import Lock
from typing import Any, cast

from agent.account_usage import _codex_backend_urls, _codex_headers, _codex_pool_route_base_url, _get_json
from agent.credential_pool import label_from_token, load_pool
from hermes_cli.auth import read_credential_pool
from hermes_cli.config import load_config

_CACHE_SECONDS = 60
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_cache_lock = Lock()
_PROVIDERS = ("openai-codex", "anthropic", "xai-oauth")


def _percent(value: Any) -> float | None:
    try:
        result = float(value)
        return round(result, 1) if math.isfinite(result) and 0 <= result <= 100 else None
    except (TypeError, ValueError):
        return None


def _date(value: Any) -> str | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(value, timezone.utc).isoformat()
        except (ValueError, OverflowError):
            return None
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except ValueError:
            return None
    return None


def _window(value: Any, reset: Any) -> dict | None:
    percent = _percent(value)
    return {"used_percent": percent, "reset_at": _date(reset)} if percent is not None else None


def codex_windows(payload: dict) -> dict:
    """Only a published duration identifies a 5-hour or weekly window."""
    windows: dict = {}
    for key in ("primary_window", "secondary_window"):
        row = (payload.get("rate_limit") or {}).get(key) or {}
        try:
            seconds = int(row.get("limit_window_seconds"))
        except (ValueError, TypeError):
            continue
        name = {18000: "five_hour", 604800: "weekly"}.get(seconds)
        if name and name not in windows:
            parsed = _window(row.get("used_percent"), row.get("reset_at"))
            if parsed:
                windows[name] = parsed
    return windows


def claude_windows(payload: dict) -> dict:
    windows = {}
    for name, key in (("five_hour", "five_hour"), ("weekly", "seven_day")):
        row = payload.get(key) or {}
        value = row.get("utilization")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1:
            value *= 100  # Anthropic reports fractional utilization for these windows.
        parsed = _window(value, row.get("resets_at"))
        if parsed:
            windows[name] = parsed
    return windows


def grok_windows(payload: dict) -> dict:
    config = payload.get("config") or {}
    period = config.get("currentPeriod") or {}
    try:
        start = datetime.fromisoformat(str(period.get("start", "")).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(period.get("end", "")).replace("Z", "+00:00"))
    except ValueError:
        return {}
    if start.tzinfo is None or end.tzinfo is None or not 6 <= (end - start).total_seconds() / 86400 <= 8:
        return {}
    parsed = _window(config.get("creditUsagePercent"), period.get("end"))
    return {"weekly": parsed} if parsed else {}


def _get_xai(url: str, token: str) -> dict:
    import httpx
    headers = {"Authorization": f"Bearer {token}", "X-XAI-Token-Auth": "xai-grok-cli",
               "User-Agent": "xai-grok-cli", "Accept": "application/json"}
    with httpx.Client(timeout=10.0, follow_redirects=False) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response.json() or {}


def _limits(provider: str, entry) -> dict:
    token = entry.runtime_api_key
    if provider == "openai-codex":
        from agent.account_usage import _title_case_slug
        url = _codex_backend_urls(_codex_pool_route_base_url(entry.runtime_base_url))[0]
        payload = _get_json(url, _codex_headers(token, None), timeout=10.0)
        return {"plan": _title_case_slug(payload.get("plan_type")), "windows": codex_windows(payload)}
    if provider == "xai-oauth":
        base = "https://cli-chat-proxy.grok.com/v1"
        payload = _get_xai(base + "/billing?format=credits", token)
        plan = None
        try:
            plan = _get_xai(base + "/settings", token).get("subscription_tier_display")
        except Exception:
            pass
        return {"plan": plan if isinstance(plan, str) else None, "windows": grok_windows(payload)}
    if provider == "anthropic":
        token = entry.runtime_api_key
        if not token:
            return {"plan": None, "windows": {}}
        payload = _get_json("https://api.anthropic.com/api/oauth/usage",
                            {"Authorization": f"Bearer {token}", "Accept": "application/json",
                             "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.0"}, timeout=10.0)
        return {"plan": None, "windows": claude_windows(payload)}
    return {"plan": None, "windows": {}}


def _cached_limits(provider: str, entry, fresh: bool) -> dict:
    key = (provider, entry.id)
    with _cache_lock:
        cached = _cache.get(key)
        if not fresh and cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
            return cached[1]
    try:
        result = _limits(provider, entry)
    except Exception:
        result = {"plan": None, "windows": {}}
    with _cache_lock:
        _cache[key] = (time.monotonic(), result)
    return result


def _claude_status(*, fresh: bool = False) -> list[dict]:
    """The DirectSDK account list comes from the CLI plugin, not the API-key pool."""
    from pathlib import Path
    from types import SimpleNamespace
    from providers import get_provider_profile
    from agent.anthropic_credentials import read_claude_code_credentials

    profile = get_provider_profile("claude-subscription-directsdk-experimental")
    list_accounts = getattr(profile, "subscription_accounts", None)
    if not callable(list_accounts):
        return []
    entries = []
    for index, row in enumerate(cast(list[dict], list_accounts()), 1):
        auth = row["auth"]
        directory = row["dir"]
        token = None
        if auth:
            if directory is None and not os.environ.get("CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR"):
                token = (read_claude_code_credentials() or {}).get("accessToken")
            else:
                # Isolated CLI accounts may live in a separate Keychain item. Never
                # substitute the ordinary account's token for a missing file credential.
                path = Path(directory or os.environ["CLAUDE_SUBSCRIPTION_DIRECTSDK_CONFIG_DIR"]) / ".credentials.json"
                try:
                    import json
                    token = (json.loads(path.read_text()).get("claudeAiOauth") or {}).get("accessToken")
                except (OSError, ValueError):
                    pass
        cached = _cached_limits("anthropic", SimpleNamespace(id=row["id"], runtime_api_key=token), fresh) if token else {"windows": {}}
        plan = auth.get("subscriptionType")
        entries.append({"id": row["id"], "index": index, "account": auth.get("email") or "Claude Code login",
                        "plan": "Claude " + plan.title() if isinstance(plan, str) and plan else None,
                        "status": "rate-limited" if row.get("limited") else "active" if auth else "needs re-login", "windows": cached["windows"],
                        "in_use": False})
    return entries


def subscription_snapshot(*, fresh: bool = False, session_id: str | None = None) -> dict:
    from agent.subscription_activity import latest

    config = load_config()
    strategies = config.get("credential_pool_strategies") or {}
    stored = read_credential_pool()
    result = []
    for provider in _PROVIDERS:
        entries = []
        if provider == "anthropic" and config.get("model", {}).get("provider") == "claude-subscription-directsdk-experimental":
            entries = _claude_status(fresh=fresh)
        else:
            pool = load_pool(provider) if provider in stored else None
            for index, entry in enumerate(pool.entries() if pool else [], 1):
                limits = _cached_limits(provider, entry, fresh) if provider != "anthropic" else {"plan": None, "windows": {}}
                status = "needs re-login" if entry.last_status == "dead" else "rate-limited" if entry.last_status == "exhausted" else "active"
                entries.append({"id": entry.id, "index": index, "account": label_from_token(entry.access_token, entry.label),
                                "plan": limits["plan"], "status": status, "windows": limits["windows"],
                                "in_use": False})
        activity = latest(provider, session_id)
        for entry in entries:
            if activity and entry["id"] == activity["account_id"] and activity["phase"] != "failed":
                entry["in_use"] = activity["phase"] == "in_flight"
                entry["last_used"] = activity["phase"] == "finished"
        result.append({"provider": provider, "strategy": strategies.get(provider, "fill_first"), "entries": entries,
                       "rotation_supported": provider != "anthropic" or bool(config.get("model", {}).get("provider") == "claude-subscription-directsdk-experimental")})
    return {"providers": result}
