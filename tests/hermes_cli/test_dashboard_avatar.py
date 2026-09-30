"""Photo presentation survives optional-claim loss without changing authentication."""
from dataclasses import replace
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from hermes_cli import web_server
from hermes_cli.dashboard_auth import clear_providers, register_provider
from hermes_cli.dashboard_auth import avatar_cache
from tests.hermes_cli.conftest_dashboard_auth import StubAuthProvider


@pytest.fixture
def dashboard(monkeypatch):
    clear_providers()
    provider = StubAuthProvider()
    register_provider(provider)
    monkeypatch.setattr(web_server.app.state, "auth_required", True, raising=False)
    monkeypatch.setattr(web_server.app.state, "bound_host", "photos.example", raising=False)
    client = TestClient(web_server.app, base_url="https://photos.example")
    start = client.get("/auth/login?provider=stub", follow_redirects=False)
    state = start.headers["location"].split("state=")[1]
    assert client.get(f"/auth/callback?code=stub_code&state={state}", follow_redirects=False).status_code == 302
    yield client, provider
    client.close()
    clear_providers()


def test_photo_survives_missing_claim_and_cache_clear_without_crossing_identities(dashboard, monkeypatch, tmp_path):
    client, provider = dashboard
    verify = provider.verify_session
    picture = "https://lh3.googleusercontent.com/a/photo"
    current = {"picture": picture}
    monkeypatch.setattr(provider, "verify_session", lambda **kw: replace(verify(**kw), **current))
    outgoing = []
    original_client = httpx.AsyncClient
    def fetch(request):
        outgoing.append(request)
        return httpx.Response(200, content=b"photo", headers={"content-type": "image/png"})
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original_client(transport=httpx.MockTransport(fetch), **kw))
    assert client.get("/api/auth/me").json()["picture"] == "/api/auth/avatar"
    image = client.get("/api/auth/avatar")
    assert image.content == b"photo"
    assert client.get("/api/auth/avatar", headers={"if-none-match": image.headers["etag"]}).status_code == 304
    current["picture"] = ""
    assert client.get("/api/auth/me").json()["picture"] == "/api/auth/avatar"
    assert client.get("/api/auth/avatar").content == image.content
    assert len(outgoing) == 1
    assert "cookie" not in outgoing[0].headers
    # Reopening the database is the real restart path: there is no in-memory cache.
    home_a = avatar_cache.get_process_hermes_home()
    path = home_a / "cache/dashboard-avatars/photos.db"
    assert path.stat().st_mode & 0o077 == 0
    current["user_id"] = "someone-else"
    assert client.get("/api/auth/me").json()["picture"] == ""
    assert client.get("/api/auth/avatar").status_code == 404
    del current["user_id"]
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "other-home"))
    assert client.get("/api/auth/me").json()["picture"] == ""
    monkeypatch.setenv("HERMES_HOME", str(home_a))
    assert client.get("/api/auth/me").json()["picture"] == "/api/auth/avatar"
    path.unlink()
    current["picture"] = picture
    assert client.get("/api/auth/avatar").content == image.content
    assert len(outgoing) == 2
    current["picture"] = "http://127.0.0.1/private"
    assert client.get("/api/auth/me").json()["picture"] == ""
    assert client.get("/api/auth/avatar").status_code == 404
    client.cookies.clear()
    assert client.get("/api/auth/avatar").status_code == 401


def test_stale_photo_survives_upstream_rate_limit_and_uncached_failure_is_retryable(dashboard, monkeypatch):
    client, provider = dashboard
    verify = provider.verify_session
    picture = "https://lh3.googleusercontent.com/a/rate-limited"
    monkeypatch.setattr(provider, "verify_session", lambda **kw: replace(verify(**kw), picture=picture))
    original_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original_client(transport=httpx.MockTransport(
        lambda request: httpx.Response(429, headers={"content-type": "text/plain"})), **kw))
    first = client.get("/api/auth/avatar")
    assert first.status_code == 502
    assert first.headers["cache-control"] == "no-store"
    avatar_cache.write_image(picture, b"last-good", "image/png")
    path = avatar_cache.get_process_hermes_home() / "cache/dashboard-avatars/photos.db"
    with sqlite3.connect(path) as db:
        db.execute("UPDATE images SET updated=updated-86401")
    assert client.get("/api/auth/avatar").content == b"last-good"
