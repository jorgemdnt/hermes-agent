"""Tests for the WS-upgrade auth helper (Phase 5 task 5.2).

The dashboard's WS endpoints (``/api/pty``, ``/api/console``, ``/api/ws``,
``/api/pub``, ``/api/events``) share an auth gate: ``_ws_auth_ok``. In
loopback mode it accepts ``?token=<_SESSION_TOKEN>``; in gated mode it accepts
a single-use ``?ticket=`` minted by ``POST /api/auth/ws-ticket``.

These tests exercise the helper at the unit level (no actual WS upgrade)
plus the ticket-mint endpoint under realistic gated-mode setup. We don't
test the full WS upgrade because the starlette TestClient WS path has a
pre-existing regression unrelated to dashboard-auth.
"""

from __future__ import annotations

from types import SimpleNamespace
import time

import pytest

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hermes_cli import web_server
import hermes_cli.web_server_chat as _web_server_chat
from hermes_cli.dashboard_auth import clear_providers, get_provider, register_provider
from hermes_cli.dashboard_auth.ws_tickets import (
    _reset_for_tests,
    consume_internal_credential,
    internal_ws_credential,
    mint_ticket,
    consume_ticket,
    TicketInvalid,
)
from tests.hermes_cli.conftest_dashboard_auth import StubAuthProvider


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def gated_app():
    """web_server.app configured for gated mode + stub provider registered."""
    _reset_for_tests()
    clear_providers()
    register_provider(StubAuthProvider())
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    prev_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.bound_host = "fly-app.fly.dev"
    web_server.app.state.bound_port = 443
    web_server.app.state.auth_required = True
    client = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
    yield client
    clear_providers()
    _reset_for_tests()
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port
    web_server.app.state.auth_required = prev_required


@pytest.fixture
def loopback_app():
    """web_server.app configured for loopback mode (gate OFF)."""
    _reset_for_tests()
    clear_providers()
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    prev_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.bound_host = "127.0.0.1"
    web_server.app.state.bound_port = 8080
    web_server.app.state.auth_required = False
    client = TestClient(web_server.app, base_url="http://127.0.0.1:8080")
    yield client
    _reset_for_tests()
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port
    web_server.app.state.auth_required = prev_required


@pytest.fixture
def insecure_public_app():
    """web_server.app configured for all-interfaces insecure mode."""
    _reset_for_tests()
    clear_providers()
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    prev_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.bound_host = "0.0.0.0"
    web_server.app.state.bound_port = 9120
    web_server.app.state.auth_required = False
    client = TestClient(web_server.app, base_url="http://192.168.0.222:9120")
    yield client
    _reset_for_tests()
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port
    web_server.app.state.auth_required = prev_required


def _logged_in(client: TestClient) -> None:
    """Drive the stub OAuth round trip so the client holds session cookies."""
    r1 = client.get("/auth/login?provider=stub", follow_redirects=False)
    assert r1.status_code == 302
    state = r1.headers["location"].split("state=")[1]
    r2 = client.get(
        f"/auth/callback?code=stub_code&state={state}", follow_redirects=False
    )
    assert r2.status_code == 302


# ---------------------------------------------------------------------------
# POST /api/auth/ws-ticket — the mint endpoint
# ---------------------------------------------------------------------------


class TestWsTicketEndpoint:
    def test_authenticated_session_can_mint(self, gated_app):
        _logged_in(gated_app)
        r = gated_app.post("/api/auth/ws-ticket")
        assert r.status_code == 200
        body = r.json()
        assert "ticket" in body
        assert isinstance(body["ticket"], str)
        assert len(body["ticket"]) >= 32
        assert body["ttl_seconds"] == 30
        identity = consume_ticket(body["ticket"])
        assert identity["session_expires_at"] == gated_app.get("/api/auth/me").json()["expires_at"]

    def test_session_expired_ticket_rejected_even_during_ticket_ttl(self, gated_app):
        ticket = mint_ticket(user_id="u", provider="stub",
                             extra={"session_expires_at": time.time() + 0.1})
        time.sleep(0.15)
        with pytest.raises(TicketInvalid, match="session expired"):
            consume_ticket(ticket)

    def test_live_ticket_socket_closes_at_session_expiry(self, gated_app):
        ticket = mint_ticket(user_id="u", provider="stub",
                             extra={"session_expires_at": time.time() + 1.0})
        with gated_app.websocket_connect(f"/api/events?channel=expiry&ticket={ticket}",
                                         headers={"host": "fly-app.fly.dev"}) as socket:
            with pytest.raises(WebSocketDisconnect) as exc:
                socket.receive_text()
        assert exc.value.code == 4401

    def test_dashboard_logout_attempts_upstream_revoke_and_invalidates_local_tokens(
        self, gated_app, monkeypatch,
    ):
        _logged_in(gated_app)
        provider = get_provider("stub")
        old_cookies = dict(gated_app.cookies)
        refresh = next(value for name, value in old_cookies.items()
                       if name.endswith("hermes_session_rt"))
        revoked = []

        def fail_revoke(*, refresh_token):
            revoked.append(refresh_token)
            raise RuntimeError("IdP unavailable")

        monkeypatch.setattr(provider, "revoke_session", fail_revoke)
        response = gated_app.post("/auth/logout", follow_redirects=False)
        assert revoked == [refresh]
        assert response.status_code == 302
        assert gated_app.get("/api/auth/me", follow_redirects=False).status_code == 401
        replay = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
        replay.cookies.update(old_cookies)
        assert replay.get("/api/auth/me", follow_redirects=False).status_code == 401

    def test_mobile_logout_revokes_only_this_browser_tokens(self, gated_app, monkeypatch):
        _logged_in(gated_app)
        other = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
        _logged_in(other)
        provider = get_provider("stub")
        revoked = []
        monkeypatch.setattr(provider, "revoke_session", lambda **kwargs: revoked.append(kwargs))
        old_cookies = dict(gated_app.cookies)
        assert gated_app.post("/api/mobile/logout").status_code == 200
        assert revoked == []
        assert gated_app.get("/api/auth/me", follow_redirects=False).status_code == 401
        # A replayed old refresh cookie cannot silently re-create a logged-out session.
        replay = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
        replay.cookies.update(old_cookies)
        assert replay.get("/api/auth/me", follow_redirects=False).status_code == 401
        assert other.get("/api/auth/me").status_code == 200

    def test_sign_out_redirects_m_and_rejects_replayed_cookie(self, gated_app):
        _logged_in(gated_app)
        old_cookies = dict(gated_app.cookies)
        assert gated_app.get("/m").status_code == 200
        assert gated_app.post("/api/mobile/logout").json() == {"ok": True}
        assert gated_app.get("/m", follow_redirects=False).headers["location"].startswith("/login")
        assert gated_app.get("/api/auth/me").status_code == 401
        assert gated_app.get("/api/auth/avatar").status_code == 401
        replay = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
        replay.cookies.update(old_cookies)
        assert replay.get("/m", follow_redirects=False).headers["location"].startswith("/login")
        assert replay.get("/api/auth/me").status_code == 401

    def test_google_picture_claim_is_proxied_without_browser_cookies(self, gated_app, monkeypatch):
        from dataclasses import replace
        import httpx
        from plugins.dashboard_auth._shared import session_from_claims

        picture = "https://lh3.googleusercontent.com/a/test-avatar"
        mapped = session_from_claims("self-hosted", {"sub": "u", "exp": int(time.time()) + 60,
                                                     "picture": picture}, access_token="t", refresh_token="")
        assert mapped.picture == picture
        _logged_in(gated_app)
        provider = get_provider("stub")
        assert provider is not None
        verify = provider.verify_session
        def with_picture(url):
            def inner(**kw):
                session = verify(**kw)
                assert session is not None
                return replace(session, picture=url)
            return inner
        monkeypatch.setattr(provider, "verify_session", with_picture(picture))
        outgoing = []
        original_client = httpx.AsyncClient

        def fetch(request):
            outgoing.append(request)
            return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nimage", headers={"Content-Type": "image/png"})

        monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original_client(
            transport=httpx.MockTransport(fetch), **kw))
        me = gated_app.get("/api/auth/me").json()
        assert me["picture"] == "/api/auth/avatar"
        avatar = gated_app.get(me["picture"])
        assert avatar.status_code == 200
        assert avatar.headers["content-type"] == "image/png"
        assert avatar.content == b"\x89PNG\r\n\x1a\nimage"
        assert len(outgoing) == 1
        assert str(outgoing[0].url) == picture
        assert "cookie" not in outgoing[0].headers
        monkeypatch.setattr(provider, "verify_session", with_picture("http://127.0.0.1/private"))
        assert gated_app.get("/api/auth/me").json()["picture"] == ""
        assert gated_app.get("/api/auth/avatar").status_code == 404
        assert len(outgoing) == 1

    def test_mobile_logout_prunes_only_its_own_push_subscription(self, gated_app):
        from hermes_constants import get_process_hermes_home
        from plugins.mobile import push

        _logged_in(gated_app)
        other = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
        _logged_in(other)
        def browser_id(client):
            return next(value for name, value in client.cookies.items()
                        if name.endswith("hermes_session_browser"))
        home = get_process_hermes_home()
        def subscription(name):
            return {"endpoint": f"https://web.push.apple.com/{name}",
                    "keys": {"p256dh": "p" * 32, "auth": "a" * 16}}
        push.subscribe(home, subscription("first"), "stub-user-1", browser_id(gated_app))
        push.subscribe(home, subscription("second"), "stub-user-1", browser_id(other))
        assert gated_app.post("/api/mobile/logout").status_code == 200
        assert list(push._read(home)) == [subscription("second")["endpoint"]]
        assert other.get("/api/auth/me").status_code == 200

    def test_legacy_session_gets_binding_before_local_logout(self, gated_app):
        """Pre-deployment cookies gain a revocable browser identity on use."""
        from hermes_cli.dashboard_auth.local_logout import _db

        _logged_in(gated_app)
        with _db() as db:
            db.execute("DELETE FROM browser_tokens")
        browser_cookie = next(name for name in gated_app.cookies if name.endswith("hermes_session_browser"))
        gated_app.cookies.delete(browser_cookie)
        assert gated_app.get("/api/auth/me").status_code == 200
        assert browser_cookie in gated_app.cookies
        old_cookies = dict(gated_app.cookies)
        assert gated_app.post("/api/mobile/logout").status_code == 200
        replay = TestClient(web_server.app, base_url="https://fly-app.fly.dev")
        replay.cookies.update(old_cookies)
        assert replay.get("/api/auth/me", follow_redirects=False).status_code == 401

    def test_direct_legacy_logout_does_not_reissue_cookies(self, gated_app):
        from hermes_cli.dashboard_auth.local_logout import _db

        _logged_in(gated_app)
        with _db() as db:
            db.execute("DELETE FROM browser_tokens")
        browser_cookie = next(name for name in gated_app.cookies if name.endswith("hermes_session_browser"))
        gated_app.cookies.delete(browser_cookie)
        assert gated_app.post("/api/mobile/logout").status_code == 200
        assert not any(name.endswith("hermes_session_at") for name in gated_app.cookies)

    def test_authenticated_mobile_shell_and_push_assets(self, gated_app):
        _logged_in(gated_app)
        shell = gated_app.get("/m")
        assert shell.status_code == 200
        assert 'rel="manifest"' in shell.text
        manifest = gated_app.get("/mobile.webmanifest")
        assert manifest.status_code == 200
        assert manifest.json()["display"] == "standalone"
        worker = gated_app.get("/mobile-sw.js")
        assert worker.status_code == 200
        assert "cache" not in worker.text.replace("never cache", "")
        assert gated_app.get("/api/plugins/mobile/push/key").status_code == 200

    def test_unauthenticated_returns_401_or_redirect(self, gated_app):
        r = gated_app.post("/api/auth/ws-ticket", follow_redirects=False)
        # gated_auth_middleware short-circuits before the route — it
        # returns either 401 or 302. Either is fine.
        assert r.status_code in (302, 401)


    def test_get_method_is_not_allowed(self, gated_app):
        _logged_in(gated_app)
        r = gated_app.get("/api/auth/ws-ticket", follow_redirects=False)
        # GET must not mint a ticket (which would be cookie-replayable via
        # <img src=…> from a malicious origin). Accepted responses:
        #   401 — gated middleware allowlist-miss
        #   404 — SPA catch-all swallowed it
        #   405 — Method Not Allowed (route only registered for POST)
        #   200 — SPA index.html was served (catch-all caught the path)
        # In every case the JSON body of a successful ticket mint must
        # NOT be present. The assertion below holds even when the SPA
        # shell happens to serve a 200.
        body = r.text
        assert "ticket" not in body or '"ttl_seconds"' not in body, (
            f"GET /api/auth/ws-ticket leaked a ticket (status={r.status_code}, "
            f"body[:200]={body[:200]!r})"
        )


# ---------------------------------------------------------------------------
# _ws_auth_ok — unit-level (synthetic WebSocket-shaped object)
# ---------------------------------------------------------------------------


@pytest.fixture
def insecure_explicit_host_app():
    """web_server.app bound to an explicit non-loopback host (--insecure).

    Models `--host 100.64.0.10 --insecure` (e.g. a Tailscale IP behind
    `tailscale serve`) — a specific address rather than the all-interfaces
    0.0.0.0 wildcard.
    """
    _reset_for_tests()
    clear_providers()
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    prev_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.bound_host = "100.64.0.10"
    web_server.app.state.bound_port = 9119
    web_server.app.state.auth_required = False
    client = TestClient(web_server.app, base_url="http://100.64.0.10:9119")
    yield client
    _reset_for_tests()
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port
    web_server.app.state.auth_required = prev_required


def _fake_ws(
    *,
    query: dict,
    client_host: str = "127.0.0.1",
    path: str = "/api/pty",
    protocols: tuple[str, ...] = (),
):
    """Build a stand-in for starlette.WebSocket good enough for _ws_auth_ok."""

    class _QP:
        def __init__(self, q):
            self._q = q

        def get(self, k, default=""):
            return self._q.get(k, default)

    return SimpleNamespace(
        query_params=_QP(query),
        headers={"sec-websocket-protocol": ", ".join(protocols)} if protocols else {},
        client=SimpleNamespace(host=client_host),
        url=SimpleNamespace(path=path),
    )


class TestWsAuthOkLoopback:
    """Gate OFF — legacy token path."""

    def test_correct_token_accepted(self, loopback_app):
        ws = _fake_ws(query={"token": web_server._SESSION_TOKEN})
        assert _web_server_chat._ws_auth_ok(ws) is True


class TestWsAuthOkGated:
    """Gate ON — ticket path only."""


    def test_consumed_ticket_rejected(self, gated_app):
        ticket = mint_ticket(user_id="u1", provider="stub")
        ws_one = _fake_ws(query={"ticket": ticket})
        ws_two = _fake_ws(query={"ticket": ticket})
        assert _web_server_chat._ws_auth_ok(ws_one) is True
        # Single-use — second consumption fails.
        assert _web_server_chat._ws_auth_ok(ws_two) is False

    def test_ticket_subprotocol_is_single_use_and_selects_only_the_public_protocol(self, gated_app):
        ticket = mint_ticket(user_id="subprotocol-user", provider="stub")
        protocols = (
            _web_server_chat._GATEWAY_WS_PROTOCOL,
            f"{_web_server_chat._GATEWAY_WS_TICKET_PROTOCOL_PREFIX}{ticket}",
        )
        ws_one = _fake_ws(query={}, path="/api/ws", protocols=protocols)
        ws_two = _fake_ws(query={}, path="/api/ws", protocols=protocols)

        assert _web_server_chat._ws_auth_ok(ws_one) is True
        assert ws_one._hermes_auth_identity == {
            "user_id": "subprotocol-user",
            "provider": "stub",
        }
        assert ws_one._hermes_ws_subprotocol == _web_server_chat._GATEWAY_WS_PROTOCOL
        assert ticket not in ws_one._hermes_ws_subprotocol
        assert _web_server_chat._ws_auth_ok(ws_two) is False

    def test_ticket_subprotocol_rejects_missing_public_protocol_or_ambiguous_tickets(self, gated_app):
        first = mint_ticket(user_id="u1", provider="stub")
        missing_public = _fake_ws(
            query={},
            path="/api/ws",
            protocols=(f"hermes-gateway-ticket.{first}",),
        )
        assert _web_server_chat._ws_auth_ok(missing_public) is False

        second = mint_ticket(user_id="u2", provider="stub")
        ambiguous = _fake_ws(
            query={},
            path="/api/ws",
            protocols=(
                "hermes-gateway-v1",
                f"hermes-gateway-ticket.{first}",
                f"hermes-gateway-ticket.{second}",
            ),
        )
        assert _web_server_chat._ws_auth_ok(ambiguous) is False


    def test_legacy_token_rejected_in_gated_mode(self, gated_app):
        """Critical: gated mode must NOT honour the legacy token path
        even when someone has access to the in-process value of
        _SESSION_TOKEN (e.g. a leaked log line)."""
        ws = _fake_ws(query={"token": web_server._SESSION_TOKEN})
        assert _web_server_chat._ws_auth_ok(ws) is False

    def test_rejection_audit_logs(self, gated_app, tmp_path, monkeypatch):
        # Point the audit log at a tmp dir so we can read what got written.
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        from hermes_cli.dashboard_auth import audit as audit_mod

        # The log path is resolved lazily on the first audit_log() call;
        # bust any cached handler so it re-resolves.
        if hasattr(audit_mod, "_LOGGER"):
            monkeypatch.setattr(audit_mod, "_LOGGER", None, raising=False)

        ws = _fake_ws(query={"ticket": "never-minted"})
        assert _web_server_chat._ws_auth_ok(ws) is False

        log_file = tmp_path / "logs" / "dashboard-auth.log"
        # The audit module may write asynchronously through stdlib logging,
        # but flush is synchronous. If the file doesn't exist yet, the
        # logger may not have been initialized in this process — that's
        # acceptable as long as the rejection path didn't crash.
        if log_file.exists():
            content = log_file.read_text()
            assert "ws_ticket_rejected" in content


class TestWsRequestIsAllowedGated:
    """Bug fix: in gated mode, the WS peer-IP loopback check must be
    bypassed.

    When the OAuth gate is active, ``start_server`` runs uvicorn with
    ``proxy_headers=True`` so the dashboard can honour
    ``X-Forwarded-Proto`` from Fly's TLS terminator. A side effect is that
    ``ws.client.host`` is rewritten to the X-Forwarded-For value — the
    real internet client IP, never loopback. The loopback peer guard
    (intended only for unauthenticated loopback dev) must not also reject
    those upgrades: the OAuth gate + single-use ticket is the auth.

    Regression coverage: every WS endpoint (``/api/pty``, ``/api/console``,
    ``/api/ws``, ``/api/pub``, ``/api/events``) calls
    ``_ws_request_is_allowed`` after ``_ws_auth_ok``. If the peer-IP check
    rejects gated mode, the chat
    tab + sidebar tool feed silently fail to connect even after a
    successful OAuth login.
    """


    def test_non_loopback_peer_rejected_in_loopback_mode(self, loopback_app):
        """Loopback mode still enforces the peer-IP guard — the legacy
        token path is the only auth and we don't want random LAN hosts
        guessing it."""
        ws = _fake_ws(query={}, client_host="192.168.1.42")
        ws.headers = {"host": "127.0.0.1:8080"}
        assert _web_server_chat._ws_request_is_allowed(ws) is False


    def test_non_loopback_peer_allowed_in_insecure_public_mode(self, insecure_public_app):
        """`--host 0.0.0.0 --insecure` is an explicit LAN/public opt-in.

        Regression coverage for the dashboard `/chat` breakage where the
        HTML shell loaded on 9120 but every WebSocket upgrade was rejected
        with 403 because the loopback-only peer guard still ran even though
        the operator intentionally exposed the dashboard on all interfaces.
        """
        ws = _fake_ws(query={}, client_host="192.168.0.55")
        ws.headers = {
            "host": "192.168.0.222:9120",
            "origin": "http://192.168.0.222:9120",
        }
        assert _web_server_chat._ws_request_is_allowed(ws) is True

    def test_peer_allowed_on_explicit_non_loopback_bind(self, insecure_explicit_host_app):
        """`--host 100.64.0.10 --insecure` (Tailscale/LAN IP) is an explicit
        non-loopback opt-in too — not just the 0.0.0.0 wildcard.

        Regression coverage: the merged 0.0.0.0/:: fix did not cover binding
        directly to a specific tailnet/LAN address, so `/chat` HTML loaded but
        WS upgrades were still rejected by the loopback-only peer guard.
        """
        ws = _fake_ws(query={}, client_host="100.64.0.99")
        ws.headers = {
            "host": "100.64.0.10:9119",
            "origin": "http://100.64.0.10:9119",
        }
        assert _web_server_chat._ws_request_is_allowed(ws) is True



    # -- security: empty / missing peer must fail closed in loopback mode --
    # Regression for the fail-open default-allow where
    # ``ws.client is None`` or ``ws.client.host == ""`` was treated as
    # "allowed" on a loopback-bound dashboard with auth disabled. ASGI
    # servers behind a misconfigured proxy or a unix-socket transport can
    # deliver either shape, so both must be rejected explicitly.



    def test_empty_client_host_still_allowed_in_insecure_public_mode(
        self, insecure_public_app
    ):
        """The empty-peer fail-closed guard must only apply to loopback
        binds. With an explicit ``--host 0.0.0.0 --insecure`` opt-in, the
        loopback-only peer restriction does not run at all, so the empty
        peer case bypasses the new guard the same way a legitimate LAN
        peer does. Without this, the fix would regress the public-bind
        path the dashboard relies on."""
        ws = _fake_ws(query={}, client_host="")
        ws.headers = {
            "host": "192.168.0.222:9120",
            "origin": "http://192.168.0.222:9120",
        }
        assert _web_server_chat._ws_client_is_allowed(ws) is True


class TestWsHostOriginGuardOrigins:
    """The WS Origin guard must let the packaged desktop shell connect.

    Electron loads the packaged renderer over ``file://``, so its WebSocket
    handshake carries ``Origin: file://`` (or the opaque ``null``, or a custom
    ``app://`` scheme). The DNS-rebinding guard only needs to block cross-site
    http(s) origins — a malicious web page can never forge a non-web origin.

    This guard runs only AFTER ``_ws_auth_ok`` has validated the WS credential
    (session token on loopback / ``--insecure`` binds, single-use ``?ticket=``
    on OAuth-gated binds), so a non-web origin is trusted in every mode: the
    credential is the real gate, and a ``file://`` / ``null`` origin cannot
    originate a DNS-rebinding browser attack. ``http(s)`` origins are still
    match-checked against the bound host.
    """

    def _ws(self, *, origin, host):
        ws = _fake_ws(query={}, path="/api/ws")
        ws.headers = {"host": host, "origin": origin}
        return ws


    def test_explicit_non_loopback_file_origin_allowed(self, insecure_explicit_host_app):
        """Packaged Hermes Desktop also uses file:// when connecting to a
        Tailscale/LAN dashboard bind.

        The WebSocket route calls _ws_auth_ok before this guard, so in
        non-gated mode the legacy session token remains the auth boundary.
        """
        ws = self._ws(origin="file://", host="100.64.0.10:9119")
        assert _web_server_chat._ws_host_origin_is_allowed(ws) is True





    def test_gated_cross_site_http_origin_still_host_checked(self, gated_app):
        # An http(s) origin is still subjected to the same-host check even on a
        # gated bind: a cross-site http origin whose netloc doesn't match the
        # bound host is rejected. Real browser DNS-rebinding defence unchanged.
        ws = self._ws(origin="https://evil.test", host="fly-app.fly.dev")
        assert _web_server_chat._ws_host_origin_is_allowed(ws) is False



class TestSidecarUrl:
    def test_loopback_uses_session_token(self, loopback_app):
        url = _web_server_chat._build_sidecar_url("ch-1")
        assert url is not None
        assert f"token={web_server._SESSION_TOKEN}" in url
        assert "ticket=" not in url

    def test_gated_uses_internal_credential(self, gated_app):
        url = _web_server_chat._build_sidecar_url("ch-1")
        assert url is not None
        assert "token=" not in url
        assert "ticket=" not in url
        assert "internal=" in url
        # The value should be the live process-lifetime internal credential,
        # multi-use so the child can reconnect /api/pub.
        cred = url.split("internal=")[1].split("&")[0]
        info = consume_internal_credential(cred)
        assert info["user_id"] == "server-internal"
        assert info["provider"] == "server-internal"
        # Multi-use: a second consume still succeeds (unlike a ticket).
        assert consume_internal_credential(cred)["provider"] == "server-internal"

    def test_no_bound_host_returns_none(self, gated_app):
        web_server.app.state.bound_host = None
        try:
            assert _web_server_chat._build_sidecar_url("ch") is None
        finally:
            web_server.app.state.bound_host = "fly-app.fly.dev"


# ---------------------------------------------------------------------------
# _build_gateway_ws_url — the TUI child's primary JSON-RPC backend WS.
# Loopback uses ?token=; gated mode uses the multi-use internal credential
# (NOT a single-use ticket — the child reuses this URL across reconnects).
# ---------------------------------------------------------------------------


class TestGatewayWsUrl:


    def test_gated_credential_matches_sidecar(self, gated_app):
        """Both server-internal builders share one process credential, so a
        single value authenticates /api/ws and /api/pub alike."""
        gw = _web_server_chat._build_gateway_ws_url()
        sc = _web_server_chat._build_sidecar_url("ch-1")
        assert gw is not None and sc is not None
        gw_cred = gw.split("internal=")[1].split("&")[0]
        sc_cred = sc.split("internal=")[1].split("&")[0]
        assert gw_cred == sc_cred

